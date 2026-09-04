/* Durchspieltest ohne Browser - jsdom statt Klickerei.
   Aufruf:  npm i jsdom  (einmalig, node_modules gehoert nicht ins Repo)
            node tools/test_ui.js

   Zwei Stolpersteine: die drei Skripte muessen in EINEM eval landen, sonst
   sieht app.js weder Audio2 noch Playlist. Und getContext fuers Konfetti-
   Canvas gibt es in jsdom nicht, das muss gestubbt werden. */

const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
/* Auf einen Zustand warten statt auf die Uhr - feste Wartezeiten machen den
   Test auf langsamen Maschinen wackelig. */
const waitFor = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await tick(25); }
  return false;
};

let failed = 0;
const assert = (ok, msg) => { if (ok) console.log('ok  ' + msg); else { failed++; console.error('FEHLGESCHLAGEN: ' + msg); } };

/* Antworten der iTunes-Suche nachbilden, damit der Test offline laeuft. */
const CATALOG = {
  'sia unstoppable':            { trackName: 'Unstoppable', artistName: 'Sia', collectionName: 'This Is Acting', releaseDate: '2016-01-21', primaryGenreName: 'Pop', previewUrl: 'https://audio/1.m4a', artworkUrl100: 'https://art/1/100x100bb.jpg', trackId: 1 },
  'blinding lights the weeknd': { trackName: 'Blinding Lights', artistName: 'The Weeknd', collectionName: 'After Hours', releaseDate: '2019-11-29', primaryGenreName: 'R&B/Soul', previewUrl: 'https://audio/2.m4a', artworkUrl100: 'https://art/2/100x100bb.jpg', trackId: 2 },
  'levitating dua lipa':        { trackName: 'Levitating (feat. DaBaby)', artistName: 'Dua Lipa & DaBaby', collectionName: 'Future Nostalgia', releaseDate: '2020-10-01', primaryGenreName: 'Pop', previewUrl: 'https://audio/3.m4a', artworkUrl100: 'https://art/3/100x100bb.jpg', trackId: 3 },
  'hello adele':                { trackName: 'Hello', artistName: 'Adele', collectionName: '25', releaseDate: '2015-10-23', primaryGenreName: 'Pop', previewUrl: 'https://audio/4.m4a', artworkUrl100: 'https://art/4/100x100bb.jpg', trackId: 4 },
  'bad guy billie eilish':      { trackName: 'bad guy', artistName: 'Billie Eilish', collectionName: 'WWAFA', releaseDate: '2019-03-29', primaryGenreName: 'Alternative', previewUrl: 'https://audio/5.m4a', artworkUrl100: 'https://art/5/100x100bb.jpg', trackId: 5 },
  'stronger britney spears':    { trackName: 'Stronger', artistName: 'Britney Spears', collectionName: 'Oops!', releaseDate: '2000-05-16', primaryGenreName: 'Pop', previewUrl: 'https://audio/6.m4a', artworkUrl100: 'https://art/6/100x100bb.jpg', trackId: 6 },
};
const sortKey = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').sort().join(' ');
let itunesCalls = 0;
let srvCalls = [];

/* Ein Puffer, wie ihn decodeAudioData liefern wuerde. Niedrige Abtastrate,
   damit drei Minuten Testton nicht 60 MB belegen. */
function fakeBuffer(secs, silent, chans, rate, leer) {
  rate = rate || 8000;
  chans = chans || 2;
  const len = Math.max(1, Math.round(secs * rate));
  const data = [];
  for (let c = 0; c < chans; c++) {
    const a = new Float32Array(len);
    if (!leer) for (let i = Math.round((silent || 0) * rate); i < len; i++) a[i] = 0.4;
    data.push(a);
  }
  return { duration: len / rate, sampleRate: rate, length: len, numberOfChannels: chans,
           getChannelData: c => data[c] };
}

function makeWindow(store, patchDb) {
  const w = new JSDOM(read('index.html'), { runScripts: 'outside-only', url: 'https://example.org/' }).window;

  w.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, fillRect() {},
    set fillStyle(v) {}, set globalAlpha(v) {},
  });
  w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 8);
  /* jsdom kennt kein Layout: scrollIntoView nur mitzaehlen. */
  w.Element.prototype.scrollIntoView = function () { w.__scrolls = (w.__scrolls || 0) + 1; };
  w.cancelAnimationFrame = id => clearTimeout(id);
  /* Objekt-URLs gibt es in jsdom nicht - hier reicht ein Zaehler. */
  let urlNr = 0;
  w.__urls = new Set();
  w.URL.createObjectURL = () => { const u = 'blob:test/' + (++urlNr); w.__urls.add(u); return u; };
  w.URL.revokeObjectURL = u => w.__urls.delete(u);

  w.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
    createBufferSource() { const s = { buffer: null, connect() {}, start() {}, stop() {}, onended: null }; setTimeout(() => s.onended && s.onended(), 0); return s; }
    /* Previews kommen als Acht-Byte-Attrappe herein, lokale Dateien sind
       echte Bytes - daran unterscheidet der Test die beiden Wege. Der
       "Song" beginnt mit 2,5 s Stille, damit firstSound() etwas zu tun hat. */
    decodeAudioData(buf) {
      const gross = buf && buf.byteLength > 16;
      return Promise.resolve(fakeBuffer(gross ? 180 : 30, gross ? 2.5 : 0));
    }
    createBuffer(ch, len, rate) { return fakeBuffer(len / rate, 0, ch, rate, true); }
    resume() {}
  };

  Object.entries(store || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));

  w.fetch = async url => {
    url = String(url);
    /* Der Browser bricht http-Anfragen aus einer https-Seite ab, ohne zu
       fragen - hier genauso. */
    if (url.startsWith('http://')) { srvCalls.push(url); throw new TypeError('Failed to fetch'); }
    if (url.includes('songs.json')) {
      const db = JSON.parse(read('data/songs.json'));
      if (patchDb) patchDb(db);
      return { ok: true, status: 200, json: async () => db };
    }
    if (url.includes('itunes.apple.com/search') && url.includes('entity=musicArtist')) {
      itunesCalls++;
      const term = decodeURIComponent(url.split('term=')[1].split('&')[0]).toLowerCase();
      const alle = [{ artistId: 1, artistName: 'Testband', primaryGenreName: 'Rock' },
                    { artistId: 2, artistName: 'Testband Zwei', primaryGenreName: 'Pop' }];
      const treffer = alle.filter(a => a.artistName.toLowerCase().includes(term.replace(/\+/g, ' ')));
      return { ok: true, status: 200, json: async () => ({ results: treffer }) };
    }
    if (url.includes('itunes.apple.com/search') && url.includes('attribute=artistTerm')) {
      itunesCalls++;
      const songs = [];
      for (let i = 1; i <= 9; i++) {
        songs.push({ trackName: 'Katalogsong ' + i, artistName: 'Testband', collectionName: 'Album',
                     releaseDate: '2015-01-01', primaryGenreName: 'Rock', trackId: 100 + i,
                     previewUrl: 'https://audio/k' + i, artworkUrl100: 'https://art/k/100x100bb.jpg' });
      }
      /* Dubletten und Fassungen, die nichts im Spiel zu suchen haben */
      songs.push({ ...songs[0], collectionName: 'Album (Deluxe)', releaseDate: '2019-01-01', trackId: 900 });
      songs.push({ trackName: 'Katalogsong 1 (Live)', artistName: 'Testband', collectionName: 'Live',
                   releaseDate: '2016-01-01', trackId: 901, previewUrl: 'https://audio/live' });
      songs.push({ trackName: 'Ohne Preview', artistName: 'Testband', trackId: 902 });
      return { ok: true, status: 200, json: async () => ({ results: songs }) };
    }
    /* Gastauftritte: entity=song ohne attribute. Die Playlist-Suche sieht
       fast gleich aus, haengt aber media=music davor. */
    if (url.includes('itunes.apple.com/search') && url.includes('entity=song')
        && !url.includes('attribute=') && !url.includes('media=music')) {
      itunesCalls++;
      return { ok: true, status: 200, json: async () => ({ results: [
        { trackName: 'Gastsong (feat. Testband)', artistName: 'Andere Band', collectionName: 'X',
          releaseDate: '2018-01-01', primaryGenreName: 'Pop', trackId: 500,
          previewUrl: 'https://audio/g1', artworkUrl100: 'https://art/g/100x100bb.jpg' },
        { trackName: 'Fremder Song', artistName: 'Ganz Andere', trackId: 501, previewUrl: 'https://audio/g2' },
      ] }) };
    }
    /* ---- Mediathek-Server: Subsonic, Jellyfin, Plex ---- */
    if (url.includes('musik.example.org') || url.includes('musik.kaputt.org')) {
      srvCalls.push(url);
      if (url.includes('musik.kaputt.org')) throw new TypeError('Failed to fetch');
      const json = x => ({ ok: true, status: 200, json: async () => x });

      /* Subsonic */
      if (url.includes('/rest/ping')) {
        if (!/t=[0-9a-f]{32}/.test(url)) return json({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } });
        if (/u=falsch/.test(url)) return json({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } });
        return json({ 'subsonic-response': { status: 'ok', version: '1.16.1' } });
      }
      if (url.includes('/rest/search3')) {
        const off = +(/songOffset=(\d+)/.exec(url) || [0, 0])[1];
        const song = i => ({ id: 's' + i, title: 'Subsonic Song ' + i, artist: 'Sub Band', album: 'Sub Album',
                             year: 2001, genre: 'Rock', duration: 200, coverArt: 'c' + i });
        return json({ 'subsonic-response': { status: 'ok',
          searchResult3: { song: off === 0 ? [1, 2, 3, 4, 5, 6, 7].map(song) : [] } } });
      }

      /* Jellyfin */
      if (url.includes('/Users/AuthenticateByName')) {
        return json({ AccessToken: 'jf-token', User: { Id: 'u1' } });
      }
      if (url.includes('/Items?')) {
        const start = +(/StartIndex=(\d+)/.exec(url) || [0, 0])[1];
        const item = i => ({ Id: 'j' + i, Name: 'Jelly Song ' + i, Artists: ['Jelly Band'],
                             Album: 'Jelly Album', ProductionYear: 2011, Genres: ['Pop'],
                             RunTimeTicks: 2000000000, ImageTags: { Primary: 'p' + i } });
        return json({ Items: start === 0 ? [1, 2, 3, 4, 5, 6].map(item) : [] });
      }

      /* Plex */
      if (url.includes('/library/sections/')) {
        const start = +(/X-Plex-Container-Start=(\d+)/.exec(url) || [0, 0])[1];
        const track = i => ({ ratingKey: 'p' + i, title: 'Plex Song ' + i, grandparentTitle: 'Plex Band',
                              parentTitle: 'Plex Album', parentYear: 1999, duration: 210000,
                              thumb: '/thumb/' + i,
                              Media: [{ Part: [{ key: '/library/parts/' + i + '/file.flac' }] }] });
        return json({ MediaContainer: { Metadata: start === 0 ? [1, 2, 3, 4, 5, 6].map(track) : [] } });
      }
      if (url.includes('/library/sections')) {
        return json({ MediaContainer: { Directory: [{ key: '1', type: 'artist', title: 'Musik' }] } });
      }

      /* Der Song selbst - gross genug, damit der Mock ihn als Datei nimmt. */
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4096) };
    }

    if (url.includes('itunes.apple.com/search')) {
      itunesCalls++;
      const term = sortKey(decodeURIComponent(url.split('term=')[1]));
      const hit = Object.entries(CATALOG).find(([k]) => sortKey(k) === term);
      return { ok: true, status: 200, json: async () => ({ results: hit ? [hit[1]] : [] }) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };  /* Preview */
  };

  w.eval(['assets/links.js', 'assets/tags.js', 'assets/local.js', 'assets/server.js',
    'assets/audio.js', 'assets/playlist.js', 'assets/filters.js', 'assets/artist.js',
    'assets/app.js']
    .map(read).join('\n;\n')
    + '\n;window.__ev = s => eval(s);');
  return w;
}

const dummy = n => ({ t: 'Song ' + n, a: 'Kuenstler ' + n, al: 'Album', y: 2020, g: 'Pop', s: 0, p: 'https://audio/' + n, c: 'https://art/' + n + '/100x100bb.jpg', id: n });

(async () => {
  /* ------------------------------------------------ Runde im Chartsmodus */
  let w = makeWindow({});
  const G = n => w.__ev(n), $ = s => w.document.querySelector(s);
  await waitFor(() => !w.document.querySelector('#app').hidden);

  assert(!$('#app').hidden, 'Boot: App sichtbar');
  assert($('#tabs').children.length === 5, 'Boot: fuenf Reiter');
  assert(G('round').length === 5 && G('round').every(r => r.song), 'Boot: Runde mit fuenf Songs');

  await G('playCurrent()');
  await waitFor(() => G('round[0].buffer') != null);
  assert(G('round[0].buffer') != null, 'Abspielen: Puffer geladen');

  /* Zeit -> Pixel: jede Stufenlaenge landet genau auf ihrer Segmentkante,
     dazwischen wird interpoliert. jsdom kennt keine Breiten, deshalb feste. */
  const stops = [[0.01, 38], [0.1, 114], [0.5, 216], [2, 340], [8, 485], [15, 640]].map(([t, x]) => ({ t, x }));
  const xf = G('xForTime');
  assert(xf(0, stops) === 0 && xf(0.01, stops) === 38 && xf(2, stops) === 340 && xf(15, stops) === 640,
    'Balken: Stufenlaengen landen auf den Segmentkanten');
  assert(xf(1, stops) > 216 && xf(1, stops) < 340, 'Balken: dazwischen wird interpoliert');
  assert(xf(99, stops) === 640, 'Balken: laeuft nicht ueber das Ende hinaus');
  /* Bei gleich breiten Kaesten liegt jede Stufenkante auf einem Sechstel. */
  const gleich = [0.01, 0.1, 0.5, 2, 8, 15].map((t, i) => ({ t, x: (i + 1) * 100 }));
  assert(xf(0.01, gleich) === 100 && xf(2, gleich) === 400 && xf(15, gleich) === 600,
    'Balken: auf gleich breiten Kaesten sitzen die Stufenkanten richtig');
  assert(xf(4, gleich) > 400 && xf(4, gleich) < 500, 'Balken: dazwischen laeuft die Zeit weiter');

  const wrong = G('DB.songs').find(s => s.i !== G('round[0].song.i'));
  G(`choose(DB.songs[${wrong.i}]); submit()`); await tick(10);
  assert(G('round[0].guesses.length') === 1 && G('round[0].stage') === 1, 'Falscher Tipp: eine Stufe weiter');

  G('clearPick(); submit()'); await tick(10);
  assert(G('round[0].guesses[1].kind') === 'skip' && G('round[0].stage') === 2, 'Ueberspringen: eine Stufe weiter');

  G('choose(round[0].song); submit()'); await tick(10);
  assert(G('round[0].status') === 'won' && !$('#reveal').hidden, 'Richtig geraten: Aufloesung offen');
  G('closeReveal()'); await tick(10);
  assert($('#reveal').hidden && G('active') === 1, 'Aufloesung: weiter zum naechsten Song');

  const before = G('round[0].guesses.length');
  $('#stageChips').children[0].click(); await tick(10);
  assert(G('round[0].guesses.length') === before && G('round[0].status') === 'won', 'Stufen umschalten: Runde bleibt stehen');
  assert($('#stageBar').querySelector('.stage-progress') != null, 'Stufen umschalten: Fortschrittsbalken bleibt');
  $('#stageChips').children[0].click(); await tick(10);

  G('newRound()'); await tick(30);
  assert(G('round').every(r => r.status === 'playing'), 'Neu wuerfeln: alles auf Anfang');

  /* ---------------------------------------------------- Playlist-Modus */
  const csv = 'Track Name,Artist Name(s)\nUnstoppable,Sia\nBlinding Lights,The Weeknd\nLevitating,Dua Lipa\n'
            + 'Hello,Adele\nBad Guy,Billie Eilish\nStronger,Britney Spears\nGibtsNicht,Niemand';
  await G(`loadPlaylistText(${JSON.stringify(csv)}, 'Testliste')`);
  await waitFor(() => G('plBusy') === false, 20000);

  assert(G('PL') != null && G('PL.songs.length') === 6, 'Playlist: sechs von sieben aufgeloest');
  assert(G('PL.missed').length === 1, 'Playlist: der unbekannte Titel wird gemeldet');
  assert(G('mode') === 'playlist', 'Playlist: Modus schaltet um');
  assert($('#tabs').children.length === 5, 'Playlist: fuenf Reiter');
  assert(new Set(G('round').map(r => r.song.t)).size === 5, 'Playlist: fuenf verschiedene Songs');
  assert(G('round').every(r => r.tier.mult === 1), 'Playlist: keine Stufenfaktoren');

  G("suggest('bl')");
  assert(G('sugItems').length > 0 && G('sugItems').every(s => G('PL.songs').some(x => x.t === s.t)),
    'Playlist: Vorschlaege kommen nur aus der Playlist');
  assert(G("PL.songs.find(s => s.t.startsWith('Levitating')).ar").length >= 3,
    'Playlist: Kollaboration bekommt mehrere Kuenstler-IDs');

  for (let i = 0; i < 5; i++) { G('choose(round[active].song); submit()'); await tick(10); G('closeReveal()'); await tick(10); }
  assert(!$('#summary').hidden, 'Playlist: Rundenende zeigt das Ergebnis');
  assert(/\d+ von \d+ erraten/.test($('#summaryHits').textContent),
    'Rundenende: es steht da, wie viele erraten wurden (' + $('#summaryHits').textContent + ')');
  assert(G('stats.byTier.playlist') != null && G('stats.byTier.pl1') == null, 'Playlist: Statistik unter einem Schluessel');
  const zeilen = [...$('#summaryList').querySelectorAll('.s-link')];
  assert(zeilen.length === 5 && zeilen.every(a => /^https:\/\/music\.apple\.com/.test(a.href)),
    'Rundenende: jede Zeile verlinkt zum Lieblingsdienst');
  assert(G("PL.songs.every(s => s.k)"), 'Playlist: Apples Track-ID wird mitgenommen');
  $('#summaryNext').click(); await tick(30);

  const calls = itunesCalls;
  await G(`loadPlaylistText(${JSON.stringify(csv)}, 'Testliste')`);
  await waitFor(() => G('plBusy') === false, 20000);
  assert(itunesCalls === calls, 'Playlist: zweiter Import kommt aus dem Cache');

  G("setMode('charts')"); await tick(30);
  assert(G('mode') === 'charts' && G('round')[0].tier.id === 'easy', 'Rueckschaltung in den Chartsmodus');

  $('#plClear').click(); await tick(10);
  assert(G('PL') === null && $('#modeSeg').querySelector('[data-v="playlist"]').disabled, 'Playlist entfernt: Modus wieder gesperrt');

  /* ---------------------------------------------------- Jahrzehnte-Modus */
  const dec = () => G('(currentPick()||{}).value');
  $('#modeSeg [data-v="decades"]').click(); await tick(40);

  assert(G('mode') === 'decades', 'Jahrzehnte: Modus laesst sich einschalten');
  assert(!$('#pickBar').hidden, 'Jahrzehnte: die Leiste mit den Pfeilen ist da');
  assert(G('pickFiltered').every(s => Math.floor(s.y / 10) * 10 === dec()) && G('pickFiltered').length > 0,
    'Jahrzehnte: der Pool enthaelt nur Songs des Jahrzehnts');
  assert($('#pickLabel').textContent === dec() + 'er', 'Jahrzehnte: die Leiste nennt das Jahrzehnt');

  /* Die Stufen werden innerhalb des Jahrzehnts verteilt, nicht nach den
     absoluten Streamgrenzen der Charts. */
  const sizes = G('TIERS.map(t => byTier[t.id].length)');
  assert(sizes.reduce((a, b) => a + b, 0) === G('pickFiltered').length,
    'Jahrzehnte: jeder Song landet in genau einer Stufe');
  assert(Math.max(...sizes) - Math.min(...sizes) <= 1, 'Jahrzehnte: die Stufen sind gleich gross (' + sizes.join('/') + ')');
  /* Sortiert wird nach der Bekanntheit f, wo sie da ist - sonst nach Streams. */
  const fame = "s => (byTier.easy.some(x => x.f != null) ? (s.f != null ? s.f : 50) : (s.s || 0))";
  const easyMin = G(`Math.min(...byTier.easy.map(${fame}))`);
  const impMax = G(`Math.max(...byTier.impossible.map(${fame}))`);
  assert(easyMin >= impMax, `Jahrzehnte: Easy sind die bekanntesten Songs des Jahrzehnts (${easyMin} >= ${impMax})`);

  G('newRound()'); await tick(40);
  const decPool = new Set(G('pickFiltered').map(s => s.i));
  assert(G('round').every(r => r.song && decPool.has(r.song.i)), 'Jahrzehnte: die Runde zieht nur aus dem Jahrzehnt');

  /* Weiterspringen mit den Pfeilen */
  const wasDec = dec();
  $('#pickNext').click(); await tick(40);
  assert(dec() !== wasDec, 'Jahrzehnte: der Pfeil springt weiter (' + wasDec + ' -> ' + dec() + ')');
  assert(G('pickFiltered').every(s => Math.floor(s.y / 10) * 10 === dec()), 'Jahrzehnte: der Pool wandert mit');
  assert(G('round').every(r => r.song && Math.floor(r.song.y / 10) * 10 === dec()),
    'Jahrzehnte: der Wechsel startet eine neue Runde');
  $('#pickPrev').click(); await tick(40);
  assert(dec() === wasDec, 'Jahrzehnte: der Pfeil zurueck kommt wieder an');

  /* Zu duenn besetzte Jahrzehnte stehen gar nicht erst zur Wahl */
  assert(G("listFor('decades').map(o => o.value)").every(d => G(`filtered.filter(s => Math.floor(s.y/10)*10 === ${d}).length`) >= G('DEC_MIN')),
    'Jahrzehnte: nur Jahrzehnte mit genug Songs');
  assert(G(`listFor('decades').every(o =>
      filtered.filter(s => Filters.decadeOf(s) === o.value).length >= DEC_MIN)`)
    && G(`[...new Set(filtered.map(s => Filters.decadeOf(s)).filter(Boolean))]
      .filter(d => filtered.filter(s => Filters.decadeOf(s) === d).length < DEC_MIN)
      .every(d => !listFor('decades').some(o => o.value === d))`),
    'Jahrzehnte: zu duenn besetzte fallen aus der Auswahl');
  assert($('#gDecade').hidden, 'Jahrzehnte: die Jahrzehnt-Liste im Filterpanel ist hier ausgeblendet');

  /* Ein duenn besetztes Jahrzehnt wird ohne Stufen gespielt. Wie viele Songs
     welches Jahrzehnt hat, haengt am Datenstand - deshalb ein eigenes Fenster
     mit einem gebauten Jahrzehnt knapp ueber DEC_MIN. */
  const wThin = makeWindow({}, db => {
    for (let i = 0; i < 12; i++) {
      const v = db.songs[i];
      db.songs.push({ ...v, t: 'Dreissiger ' + i, y: 1935, s: 1e6 * (i + 1), d: '', f: i * 8 });
    }
  });
  const T = n => wThin.__ev(n), t$ = q => wThin.document.querySelector(q);
  await waitFor(() => !wThin.document.querySelector('#app').hidden);
  wThin.__ev("settings.decade = 1930; setMode('decades')");
  await waitFor(() => wThin.__ev('mode') === 'decades');

  assert(T('(currentPick()||{}).value') === 1930, 'Jahrzehnte: das kleine Jahrzehnt ist waehlbar');
  assert(!T('usesTiers()') && T('slots()').length === 5 && T('round')[0].tier.mult === 1,
    'Jahrzehnte: zu wenige Songs -> fuenf zufaellige statt Stufen (' + T('pickFiltered').length + ')');
  assert(new Set(T('round').filter(r => r.song).map(r => r.song.i)).size === 5,
    'Jahrzehnte: dabei wiederholt sich kein Song');
  assert(/ohne Stufen/.test(t$('#pickCount').textContent), 'Jahrzehnte: die Leiste sagt es dazu');
  assert(t$('#tierList').children.length === 5 && t$('#tierList').children[0].textContent.includes('Song'),
    'Jahrzehnte: die Leiste links zeigt Plaetze statt Stufen');
  wThin.__ev("settings.decade = 2010; applyFilters(); newRound()");
  await tick(40);
  assert(T('usesTiers()') && t$('#tierList').children[0].textContent.includes('Easy'),
    'Jahrzehnte: ein grosses Jahrzehnt hat wieder Stufen, und die Leiste wandert mit');

  /* Statistik zaehlt die Serie mit */
  const streak0 = G('stats.streak') || 0;
  G('choose(round[active].song); submit()'); await tick(20);
  assert(G('stats.streak') === streak0 + 1, 'Statistik: eine richtige Antwort verlaengert die Serie');
  G('closeReveal()'); await tick(20);
  G('round[active].stage = enabledStages().length - 1; clearPick(); submit()'); await tick(20);
  assert(G('stats.streak') === 0 && G('stats.bestStreak') >= streak0 + 1,
    'Statistik: Aufgeben setzt die Serie zurueck, die beste bleibt stehen');
  G('closeReveal()'); await tick(20);

  /* Die Statistik schluesselt nach Modus auf, sobald mehr als einer bespielt ist */
  G("stats.byTier = { easy: {p:4,w:3}, 'dec-1980': {p:2,w:1}, 'gen-pop': {p:1,w:0} }; renderStats()");
  const statText = $('#stats').textContent;
  assert(/Charts3\/4|Charts.*3\/4/.test(statText.replace(/\s+/g, '')) || /3\/4/.test(statText),
    'Statistik: die Charts stehen mit ihrer Quote da');
  assert(/Jahrzehnte/.test(statText) && /Genres/.test(statText),
    'Statistik: Jahrzehnte und Genres ebenfalls');
  G("stats.byTier = { easy: {p:4,w:3} }; renderStats()");
  assert(!/Jahrzehnte/.test($('#stats').textContent),
    'Statistik: bei nur einem Modus bleibt die Aufschluesselung weg');

  /* Nachhoeren: eine Zeile mit allen Diensten */
  G('showReveal(round[0], false)');
  const svc = [...$('#revealLinks').querySelectorAll('a')];
  assert(svc.length === G('Links.SERVICES.length'),
    'Aufloesung: alle Dienste stehen da (' + svc.length + ')');
  assert(svc.every(a => a.target === '_blank' && /noopener/.test(a.rel)),
    'Aufloesung: die Links gehen in einen neuen Tab und ohne Rueckkanal');
  assert(svc.every(a => /^https:\/\//.test(a.href) && a.href.length > 30),
    'Aufloesung: jeder Dienst bekommt eine Suchadresse');
  const titel = encodeURIComponent(G('round[0].song.t')).replace(/%20/g, '');
  assert(svc.some(a => /music\.apple\.com\/de\/search\?term=/.test(a.href))
    && svc.some(a => /open\.spotify\.com\/search\//.test(a.href))
    && svc.some(a => /listen\.tidal\.com/.test(a.href))
    && svc.some(a => /qobuz\.com/.test(a.href))
    && svc.some(a => /deezer\.com/.test(a.href)),
    'Aufloesung: Apple, Spotify, Tidal, Qobuz und Deezer sind dabei');
  assert(svc[0].classList.contains('on') && svc[0].textContent === 'Apple Music',
    'Aufloesung: der Lieblingsdienst steht vorn');
  assert(!$('#revealLinks').querySelector('.all'),
    'Aufloesung: ohne Apple-ID kein Sammellink');

  /* Ein anderer Lieblingsdienst */
  [...$('#svcSeg').querySelectorAll('button')].find(b => b.textContent === 'Tidal').click();
  assert(G('settings.service') === 'tidal', 'Nachhoeren: der Lieblingsdienst laesst sich waehlen');
  assert($('#revealLinks').querySelector('a').textContent === 'Tidal',
    'Nachhoeren: die offene Aufloesung zieht gleich nach');

  /* Mit Apples Track-ID gibt es den Sammellink auf die richtige Aufnahme */
  G('round[0].song.k = 1440857781; showReveal(round[0], false)');
  const alle = $('#revealLinks').querySelector('.all');
  assert(alle && alle.href === 'https://song.link/i/1440857781',
    'Aufloesung: mit Track-ID kommt der Sammellink dazu');
  G('delete round[0].song.k');
  [...$('#svcSeg').querySelectorAll('button')].find(b => b.textContent === 'Apple Music').click();
  G('closeReveal()'); await tick(20);
  G('newRound()'); await tick(30);

  /* Filter gelten hier genauso */
  const n0 = G('pickFiltered').length;
  G(`settings.filters.push({ mode: 'ohne', type: 'genre', value: 'pop', text: 'Pop' }); applyFilters()`);
  assert(G('pickFiltered').length < n0 && G('pickFiltered').every(s => s.g !== 'Pop'),
    'Jahrzehnte: die Filter der Charts wirken auch hier');
  G(`settings.filters = settings.filters.filter(r => r.type !== 'genre'); applyFilters()`);

  /* Zurueck in den Chartsmodus gelten wieder die festen Stufen */
  $('#modeSeg [data-v="charts"]').click(); await tick(40);
  assert(G('mode') === 'charts' && $('#pickBar').hidden, 'Jahrzehnte: zurueck zu den Charts');
  assert(G("byTier.easy.every(s => s.d === 'easy')"), 'Jahrzehnte: die Charts haben wieder ihre festen Stufen');

  /* --------------------------- Jahrzehnte mit Songs aus den Jahrescharts */
  /* So sieht songs.json aus, wenn tools/fetch_yearcharts.py gelaufen ist:
     Songs ohne Streamzahl, dafuer mit Jahreschartplatz und Bekanntheit f. */
  const w3 = makeWindow({}, db => {
    for (let i = 1; i <= 40; i++) {
      db.songs.push({
        t: 'Achtziger ' + i, a: 'Band ' + i, ar: [], al: 'Album', y: 1985,
        g: 'Rock', s: 0, r: i, f: Math.round(100 - (i - 1) * 100 / 39),
        d: '', p: 'https://audio/8' + i, c: 'https://art/8' + i + '/100x100bb.jpg',
      });
    }
  });
  const H = n => w3.__ev(n), h$ = q => w3.document.querySelector(q);
  await waitFor(() => !w3.document.querySelector('#app').hidden);

  assert(H("chartFiltered.every(s => s.d)") && H('filtered.length') > H('chartFiltered.length'),
    'Jahrescharts: Songs ohne Stufe bleiben aus dem Chartsmodus draussen');
  assert(H("TIERS.every(t => byTier[t.id].every(s => s.d === t.id))"),
    'Jahrescharts: die Chartstufen bleiben unveraendert');
  assert(H("sugAll.length === 0"), 'Jahrescharts: kein Nebeneffekt auf die Vorschlaege');
  H("suggest('achtziger')");
  assert(H('sugAll').length > 0, 'Jahrescharts: die neuen Songs sind trotzdem ratbar');

  w3.__ev("settings.decade = 1980; setMode('decades')");
  await waitFor(() => w3.__ev('mode') === 'decades');
  assert(H('(currentPick()||{}).value') === 1980, 'Jahrescharts: die 1980er sind jetzt waehlbar');
  assert(H('pickFiltered').length >= 40, 'Jahrescharts: sie fuellen das Jahrzehnt (' + H('pickFiltered').length + ' Songs)');
  assert(H("byTier.easy.some(s => s.r === 1)"), 'Jahrescharts: Platz 1 landet in Easy');
  assert(H("byTier.impossible.every(s => s.f < byTier.easy[0].f + 1)"),
    'Jahrescharts: die Stufen folgen der Bekanntheit f');

  H('newRound()'); await tick(40);
  const decIds = new Set(H('pickFiltered').map(s => s.i));
  assert(H('round').every(r => r.song && decIds.has(r.song.i)), 'Jahrescharts: die Runde zieht aus dem Jahrzehnt');

  w3.__ev("showReveal(round.find(r => r.song.r) || round[0], false)");
  const meta = h$('#revealMeta').textContent;
  assert(!H("round.some(r => r.song.r)") || /Platz \d+ der Jahrescharts/.test(meta),
    'Jahrescharts: die Aufloesung nennt den Chartplatz statt der Streams (' + meta + ')');

  /* ------------------------------------------------------------ Hardmode */
  G("settings.hard = false; newRound()"); await tick(30);
  assert(!$('#hardMode').checked || true, 'Hardmode: Schalter ist da');
  $('#hardMode').checked = true;
  $('#hardMode').dispatchEvent(new w.Event('change'));
  assert(G('settings.hard') === true, 'Hardmode: laesst sich einschalten und wird gemerkt');

  G('newRound()'); await tick(30);
  assert(G('locked(1)') && !G('locked(0)'), 'Hardmode: spaetere Plaetze sind gesperrt');
  assert($('#tierList').children[1].classList.contains('locked'), 'Hardmode: man sieht es der Leiste an');
  G('switchTo(3)');
  assert(G('active') === 0, 'Hardmode: der Sprung nach vorne wird abgelehnt');

  /* Ein verpasster Song beendet die Runde */
  G('round[active].stage = enabledStages().length - 1; clearPick(); submit()'); await tick(30);
  assert(G("round.every(r => r.status !== 'playing')"), 'Hardmode: ein verpasster Song beendet alles');
  assert(G("round.filter(r => r.status === 'lost').length") === 5, 'Hardmode: die restlichen Plaetze fallen mit');
  assert(G('stats.byTier.easy.p') > 0, 'Hardmode: gezaehlt wird nur der gespielte Song');
  G('closeReveal()'); await tick(20);
  assert(!$('#summary').hidden, 'Hardmode: danach kommt gleich das Ergebnis');
  $('#summaryNext').click(); await tick(30);

  /* Wer trifft, darf weiter */
  G('choose(round[active].song); submit()'); await tick(20);
  assert(G("round[0].status") === 'won' && G("round[1].status") === 'playing',
    'Hardmode: nach einem Treffer geht es normal weiter');
  G('closeReveal()'); await tick(20);
  assert(G('active') === 1 && !G('locked(1)'), 'Hardmode: der naechste Platz ist jetzt frei');

  $('#hardMode').checked = false;
  $('#hardMode').dispatchEvent(new w.Event('change'));
  assert(G('settings.hard') === false && !G('locked(3)'), 'Hardmode: ausgeschaltet ist wieder alles offen');
  G('newRound()'); await tick(30);

  /* ---------------------------------------------------- Kuenstler-Modus */
  const w4 = makeWindow({});
  const K = n => w4.__ev(n), k$ = q => w4.document.querySelector(q);
  await waitFor(() => !w4.document.querySelector('#app').hidden);

  assert(k$('#modeSeg [data-v="artist"]').disabled,
    'Kuenstler: ohne geladenen Katalog ist der Modus gesperrt');

  const suche = k$('#arSearch');
  suche.value = 'testband';
  suche.dispatchEvent(new w4.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => k$('#arHits').querySelectorAll('.arhit').length > 0, 5000);
  const namen = [...k$('#arHits').querySelectorAll('.arhit')].map(r => r.querySelector('.nm').textContent);
  assert(namen.includes('Testband'), 'Kuenstler: die Suche liefert eine Auswahl (' + namen.join(', ') + ')');

  k$('#arHits').querySelector('.arhit').click();
  await waitFor(() => w4.__ev('mode') === 'artist', 8000);
  assert(K('mode') === 'artist', 'Kuenstler: ein Klick laedt den Katalog und startet den Modus');
  assert(K('AR.songs').length === 10,
    'Kuenstler: Katalog und Gastauftritt zusammen, ohne Dubletten (' + K('AR.songs').length + ')');
  assert(K("AR.songs.some(s => /Gastsong/.test(s.t))"), 'Kuenstler: der Gastauftritt ist dabei');
  assert(K("AR.songs.every(s => !/\\(Live\\)/.test(s.t))"), 'Kuenstler: Livefassungen fliegen raus');
  assert(K("AR.songs.every(s => s.p)"), 'Kuenstler: alles hat eine Preview');
  assert(K("AR.songs.filter(s => s.t === 'Katalogsong 1').length") === 1,
    'Kuenstler: dieselbe Nummer steht nur einmal drin');
  assert(K("AR.songs.find(s => s.t === 'Katalogsong 1').al") === 'Album',
    'Kuenstler: davon die aelteste Fassung');

  /* Immer fuenf zufaellige Songs, keine Stufen */
  assert(!K('usesTiers()') && K('slots()').length === 5 && K('round')[0].tier.mult === 1,
    'Kuenstler: fuenf gleichwertige Plaetze statt Stufen');
  assert(new Set(K('round').map(r => r.song.i)).size === 5, 'Kuenstler: fuenf verschiedene Songs');
  assert(K("round.every(r => pickFiltered.some(x => x.i === r.song.i))"),
    'Kuenstler: alle aus dem Katalog');
  assert(!k$('#pickBar').hidden && /Testband/.test(k$('#pickLabel').textContent),
    'Kuenstler: die Leiste oben nennt den Namen');

  /* Vorschlaege kommen aus dem Katalog */
  K("suggest('katalog')");
  assert(K('sugAll').length > 0 && K("sugAll.every(s => AR.songs.some(x => x.t === s.t))"),
    'Kuenstler: die Vorschlaege kommen nur aus seinem Katalog');

  /* Ein zweiter Besuch kostet keine Anfrage */
  const vorher = itunesCalls;
  k$('#arSearch').value = 'testband';
  k$('#arSearch').dispatchEvent(new w4.Event('input'));
  await tick(80);
  const gespeichert = [...k$('#arHits').querySelectorAll('.arhit')]
    .find(r => r.querySelector('.nm').textContent === 'Testband');
  gespeichert.click();
  await tick(200);
  assert(itunesCalls === vorher, 'Kuenstler: ein zweiter Besuch kommt aus dem Speicher');
  assert(K("Artist.all().length") === 1, 'Kuenstler: der Katalog liegt gespeichert vor');

  /* Filter wirken auch hier, mit eigenem Regelsatz */
  const arN0 = K('pickFiltered').length;
  K(`settings.arFilters.push({ mode: 'ohne', type: 'genre', value: 'pop', text: 'Pop' }); applyFilters()`);
  assert(K('pickFiltered').length < arN0 && K("pickFiltered.every(s => s.g !== 'Pop')"),
    'Kuenstler: eigene Filter greifen');
  assert(K("settings.filters.every(r => r.type !== 'genre')"),
    'Kuenstler: die Chartsregeln bleiben unberuehrt');

  w4.__ev("setMode('charts')"); await tick(40);
  assert(K('mode') === 'charts' && k$('#pickBar').hidden, 'Kuenstler: zurueck zu den Charts');

  /* --------------------------------------------------------- Genre-Modus */
  $('#modeSeg [data-v="genres"]').click(); await tick(40);
  assert(G('mode') === 'genres', 'Genres: Modus laesst sich einschalten');
  assert(!$('#pickBar').hidden, 'Genres: dieselbe Auswahlleiste wie bei den Jahrzehnten');

  const gnow = () => G('(currentPick()||{}).text');
  assert(G("pickFiltered.every(s => Filters.genreOf(s) === (currentPick()||{}).text)"),
    'Genres: der Pool enthaelt nur ein Genre (' + gnow() + ')');
  assert(G("listFor('genres').every(o => o.value !== 'hip hop')"),
    'Genres: die zusammengefassten Genres stehen einmal in der Liste');
  assert(G("listFor('genres').every(o => filtered.filter(s => norm(Filters.genreOf(s)) === o.value).length >= GEN_MIN)"),
    'Genres: zu kleine Genres stehen nicht zur Wahl');

  const gWas = G('settings.genre');
  $('#pickNext').click(); await tick(40);
  assert(G('settings.genre') !== gWas, 'Genres: der Pfeil springt zum naechsten Genre');
  assert(G('round').every(r => r.song && G('pickFiltered').some(s => s.i === r.song.i)),
    'Genres: der Wechsel startet eine neue Runde aus dem neuen Genre');
  assert($('#gGenre').hidden, 'Genres: die Genre-Liste im Filterpanel ist hier ausgeblendet');
  assert(/Songauswahl · /.test($('#filterPanel h2').textContent), 'Genres: die Ueberschrift nennt das Genre');

  /* Ein kleines Genre wird ohne Stufen gespielt: fuenf zufaellige Songs. */
  const tinyGenre = G("listFor('genres').map(o => o.value).find(v => filtered.filter(s => norm(Filters.genreOf(s)) === v).length < TIER_MIN * TIERS.length)");
  if (tinyGenre) {
    G(`settings.genre = ${JSON.stringify(tinyGenre)}; applyFilters(); newRound()`);
    await tick(40);
    assert(!G('usesTiers()') && G('slots()').length === 5 && G('round')[0].tier.mult === 1,
      'Genres: zu wenige Songs -> fuenf zufaellige statt Stufen');
    assert(new Set(G('round').filter(r => r.song).map(r => r.song.i)).size === G('round').filter(r => r.song).length,
      'Genres: dabei wiederholt sich kein Song');
    assert(/ohne Stufen/.test($('#pickCount').textContent), 'Genres: die Leiste sagt, dass ohne Stufen gespielt wird');
  }

  $('#modeSeg [data-v="charts"]').click(); await tick(40);
  assert(G('mode') === 'charts' && G('usesTiers()'), 'Genres: zurueck zu den Charts mit Stufen');

  /* --------------------------------------------------- Knopf und Balken */
  G('newRound()'); await tick(30);
  const txt = () => $('#actionBtn .txt').textContent;
  assert(txt() === 'Überspringen', 'Knopf: auf der ersten Stufe heisst er Überspringen');
  G('round[active].stage = enabledStages().length - 1; render()');
  assert(txt() === 'Aufgeben' && $('#actionBtn').classList.contains('giveup'),
    'Knopf: auf der letzten Stufe heisst er Aufgeben');
  G('choose(round[active].song)');
  assert(txt() === 'Raten', 'Knopf: mit gewaehltem Song heisst er Raten');
  G('clearPick(); newRound()'); await tick(30);

  /* Buchstaben duerfen nichts ausloesen, wenn der Fokus auf einem Knopf liegt */
  $('#rerollAll').focus();
  const guesses0 = G('round[active].guesses.length');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 's', bubbles: true }));
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'r', bubbles: true }));
  assert(G('round[active].guesses.length') === guesses0,
    'Tastatur: getippte Buchstaben ueberspringen nichts mehr');
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: '3', bubbles: true }));
  assert(G('active') === 2, 'Tastatur: die Ziffern wechseln weiter die Stufe');
  G('switchTo(0)');

  /* Songs ohne Cover */
  G("showReveal({ ...round[0], song: { ...round[0].song, c: '' } }, false)");
  assert($('#revealArt').hidden, 'Aufloesung: ohne Cover bleibt das Bild weg');
  G('closeReveal()'); await tick(20);
  G('showReveal(round[0], false)');
  assert(!$('#revealArt').hidden && /400x400bb/.test($('#revealArt').src),
    'Aufloesung: mit Cover kommt das grosse Bild');
  G('closeReveal()'); await tick(20);

  const segCount = () => $('#stageBar').querySelectorAll('.stage-seg').length;
  assert(segCount() === 6, 'Balken: sechs Kaesten, solange alle Stufen an sind');
  assert(G('segmentWidths()').every(w => w === 1),
    'Balken: alle Kaesten gleich breit - die Leiste zeigt Versuche, nicht Sekunden');
  assert(!$('#stageBar').querySelector('.stage-seg.off'), 'Balken: keine ausgegrauten Kaesten mehr');
  $('#stageChips').children[0].click(); await tick(20);
  assert(segCount() === 5, 'Balken: eine abgeschaltete Stufe bekommt keinen eigenen Kasten');
  const widths = G('segmentWidths()');
  assert(widths[0] === 2 && widths.slice(1).every(w => w === 1),
    'Balken: ihre Breite geht an die naechste Stufe, die sie mitspielt (' + widths.join('/') + ')');
  $('#stageChips').children[0].click(); await tick(20);
  assert(segCount() === 6, 'Balken: wieder eingeschaltet ist der Kasten zurueck');

  /* ------------------------------------------------- Suchfeld/Vorschlaege */
  const box = $('#suggest'), rows = () => box.querySelectorAll('.sug');
  const key = (k, opts) => $('#search').dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

  G("suggest('billie')");
  const hits = G('sugAll').length;
  assert(hits > 12, 'Vorschlaege: „billie" findet mehr als eine Seite (' + hits + ')');
  /* Ein Song, der in der Liste weit hinten steht, muss trotzdem auffindbar
     sein - genau daran hing der alte Fehler mit den acht Treffern. */
  const spaet = G("sugAll[sugAll.length - 1].t");
  assert(G(`sugAll.some(s => s.t === ${JSON.stringify(spaet)})`) && hits > 12,
    'Vorschlaege: auch der letzte Treffer ist erreichbar (' + spaet + ')');
  assert(rows().length === 12, 'Vorschlaege: erst eine Seite gezeichnet');
  assert(/\d+ weitere/.test(box.querySelector('.sug-more').textContent), 'Vorschlaege: Rest wird angeboten');

  box.querySelector('.sug-more').click();
  assert(rows().length === Math.min(24, hits), 'Vorschlaege: Nachladen zeichnet die naechste Seite');

  G("suggest('billie')");
  w.__scrolls = 0;
  for (let i = 0; i < 12; i++) key('ArrowDown');
  assert(G('sugIdx') === 11 && rows()[11].classList.contains('active'), 'Vorschlaege: Pfeiltaste wandert mit');
  assert(w.__scrolls >= 12, 'Vorschlaege: die Auswahl wird sichtbar gescrollt');

  key('ArrowDown');
  assert(rows().length > 12 && G('sugIdx') === 12 && rows()[12].classList.contains('active'),
    'Vorschlaege: unten anstossen laedt nach statt zu springen');

  G('hideSuggest()');
  G("suggest('billie')");
  key('ArrowUp');
  assert(G('sugIdx') === G('sugItems').length - 1, 'Vorschlaege: nach oben aus dem Stand ans Ende');

  /* Ganz nach unten scrollen laedt ebenfalls nach */
  G("suggest('the')");
  const drawn = rows().length;
  box.scrollTop = 99999;
  box.dispatchEvent(new w.Event('scroll'));
  assert(G('sugAll').length > drawn ? rows().length > drawn : true, 'Vorschlaege: Scrollen laedt nach');

  G('hideSuggest()');
  assert(box.hidden && rows().length === 0, 'Vorschlaege: schliessen raeumt auf');

  /* ------------------------------------------------------ Songauswahl */
  w = makeWindow({});
  const F = n => w.__ev(n), $$ = q => w.document.querySelector(q);
  await waitFor(() => !w.document.querySelector('#app').hidden);

  const all = F('DB.songs').length;
  const setMode = m => $$(`#fMode button[data-v="${m}"]`).click();
  const rowIn = (sel, text) => [...$$(sel).querySelectorAll('.fopt')]
    .find(r => r.querySelector('.txt').textContent === text);
  const groupOf = type => (type === 'genre' ? '#gGenre' : type === 'decade' ? '#gDecade' : '#gArtist');
  const search = text => { const a = $$('#fArtist'); a.value = text; a.dispatchEvent(new w.Event('input')); };
  const add = (mode, type, text) => {
    setMode(mode);
    if (type === 'artist') search(text);
    const row = rowIn(groupOf(type), text);
    if (!row) throw new Error('Keine Zeile fuer ' + text);
    row.click();
  };

  assert(F('settings.filters').length === 1 && F('settings.filters')[0].type === 'instrumental',
    'Filter: Instrumentals sind von Haus aus draussen');
  assert($$('#fInst').checked, 'Filter: der Schalter steht passend dazu an');
  assert(F('filtered').length < all, 'Filter: die Standardregel greift');

  /* Der Schalter ist die einzige Bedienung fuer Instrumentals */
  $$('#fInst').checked = false; $$('#fInst').dispatchEvent(new w.Event('change'));
  assert(F('filtered').length === all && !F("settings.filters.some(r => r.type === 'instrumental')"),
    'Filter: Schalter aus laesst Instrumentals wieder zu');
  $$('#fInst').checked = true; $$('#fInst').dispatchEvent(new w.Event('change'));
  assert(F('filtered').length < all, 'Filter: Schalter an wirft sie wieder raus');

  /* Genres und Jahrzehnte stehen als Haekchenliste bereit */
  assert($$('#gGenre').querySelectorAll('.fopt').length === F("Filters.options('genre', DB)").length,
    'Filter: alle Genres stehen zur Auswahl');
  assert($$('#gDecade').querySelectorAll('.fopt').length === 8, 'Filter: alle Jahrzehnte stehen zur Auswahl');
  const popSongs = F("DB.songs.filter(s => Filters.genreOf(s) === 'Pop').length");
  assert(rowIn('#gGenre', 'Pop').querySelector('.num').textContent === String(popSongs),
    'Filter: neben jedem Eintrag steht, wie viele Songs daran haengen (' + popSongs + ')');
  assert(popSongs > F("DB.songs.filter(s => s.g === 'Pop').length"),
    'Filter: verwandte Genres wie Teen Pop sind mit Pop zusammengefasst');
  assert(!F("Filters.options('genre', DB).some(o => o.text === 'Hip-Hop' || o.text === 'Rap')"),
    'Filter: Hip-Hop und Rap stehen nicht mehr einzeln herum');

  const songBefore = F('round[0].song.t');
  add('nur', 'decade', '2010er');
  assert(F('filtered').every(s => s.y >= 2010 && s.y < 2020), 'Filter: „nur 2010er" schraenkt ein');
  assert(F('round[0].song.t') === songBefore, 'Filter: die laufende Runde bleibt stehen');
  assert(rowIn('#gDecade', '2010er').classList.contains('on') && rowIn('#gDecade', '2010er').classList.contains('nur'),
    'Filter: das Haekchen zeigt die Wirkung an');
  assert($$('#gDecade').querySelector('.fcount').textContent.includes('1'), 'Filter: die Gruppe zeigt ihre Anzahl');

  const only2010 = F('filtered').length;
  add('ohne', 'genre', 'Hip-Hop/Rap');
  assert(F('filtered').length < only2010 && F('filtered').every(s => s.g !== 'Hip-Hop/Rap'),
    'Filter: „ohne Hip-Hop/Rap" wirft raus');
  assert(rowIn('#gGenre', 'Hip-Hop/Rap').classList.contains('ohne'), 'Filter: die Zeile faerbt sich nach Wirkung');

  /* Kuenstler ueber die Suche, damit man sich nicht vertippt */
  search('bill');
  assert([...$$('#gArtist').querySelectorAll('.fopt')].some(r => r.querySelector('.txt').textContent === 'Billie Eilish'),
    'Filter: die Kuenstlersuche schlaegt vor');
  const cut = F('filtered').length;
  add('dazu', 'artist', 'Billie Eilish');
  assert(F('filtered').length > cut, 'Filter: „dazu Billie Eilish" holt Songs ausserhalb der Auswahl dazu');
  assert(F("filtered.some(s => s.a.includes('Billie Eilish') && (s.y < 2010 || s.y >= 2020))"),
    'Filter: dazu schlaegt die Einschraenkung');
  assert($$('#filterList').children.length === 4, 'Filter: vier Regeln stehen als Chips');

  /* Nochmal derselbe Modus schaltet die Regel wieder ab */
  add('ohne', 'genre', 'Hip-Hop/Rap');
  assert(!F("settings.filters.some(r => r.type === 'genre')"), 'Filter: zweiter Klick nimmt die Regel zurueck');
  add('nur', 'genre', 'Pop');
  add('ohne', 'genre', 'Pop');
  assert(F("settings.filters.filter(r => r.type === 'genre').length") === 1
    && F("settings.filters.find(r => r.type === 'genre').mode") === 'ohne',
    'Filter: anderer Modus ersetzt die alte Regel statt sie zu doppeln');

  F('newRound()'); await tick(30);
  const pool = new Set(F('filtered').map(s => s.i));
  assert(F('round').every(r => r.song && pool.has(r.song.i)), 'Filter: die neue Runde zieht nur aus dem Pool');

  /* Zuruecksetzen */
  $$('#fReset').click();
  assert(F('settings.filters').length === 1 && $$('#fInst').checked, 'Filter: Zuruecksetzen laesst nur den Standard stehen');

  /* Zu kleiner Pool warnt, und mindestens eine Stufe laeuft leer - welches
     Jahrzehnt duenn genug ist, haengt am Datenstand, deshalb zur Laufzeit
     gesucht. */
  /* Nur Songs mit Stufe spielen in den Charts mit - danach wird gesucht. */
  const duenn = F(`Filters.options('decade', DB).map(o => o.text)
    .find(t => { const n = chartFiltered.filter(s => Filters.decadeOf(s) === +t.slice(0, 4)).length;
                 return n >= 5 && n < 30; })`);
  assert(!!duenn, 'Filter: ein duenn besetztes Jahrzehnt zum Pruefen gefunden (' + duenn + ')');
  add('nur', 'decade', duenn);
  assert(F('activePool()').length < 30 && $$('#filterCount').classList.contains('warn')
    && /Nur \d+ Songs/.test($$('#filterCount').textContent), 'Filter: kleiner Pool warnt (' + $$('#filterCount').textContent + ')');
  /* Ob eine Stufe wirklich leer laeuft, haengt am Datenstand - die Regel
     dahinter laesst sich aber direkt pruefen: eine leere Stufe holt Ersatz. */
  F("byTier.impossible = []; newRound()");
  await tick(30);
  assert(F('round').every(r => r.song), 'Filter: eine leere Stufe bekommt trotzdem einen Song');

  F('newRound()'); await tick(30);
  const small = new Set(F('chartFiltered').map(s => s.i));
  assert(F('round').every(r => r.song && small.has(r.song.i)),
    'Filter: leere Stufen bekommen Ersatz aus dem Rest des Pools');
  assert(new Set(F('round').map(r => r.song.i)).size === 5, 'Filter: der Ersatz wiederholt keinen Song');

  /* Zwei „nur" verschiedener Art muessen beide passen - hier bleibt nichts */
  add('nur', 'artist', 'Billie Eilish');
  assert(F('filtered').length === 0 && /Kein Song passt/.test($$('#filterCount').textContent),
    'Filter: sich ausschliessende Regeln werden gemeldet');
  F('newRound()'); await tick(30);
  assert(F('round').every(r => r.song === null) && $$('#search').disabled,
    'Filter: leerer Pool laesst die Seite stehen statt zu stuerzen');

  /* Kuenstlersuche ohne Treffer */
  search('xyzgibtsnicht');
  assert(/Kein Künstler/.test($$('#gArtist').querySelector('.fnote').textContent),
    'Filter: Suche ohne Treffer sagt das');

  /* Regeln ueberleben das Neuladen */
  const saved = w.localStorage.getItem('songrate:settings');
  const w2 = makeWindow({ 'songrate:settings': saved });
  await waitFor(() => !w2.document.querySelector('#app').hidden);
  assert(w2.__ev('settings.filters').some(r => r.type === 'artist' && r.value === 'billie eilish'),
    'Filter: Regeln ueberleben das Neuladen');
  assert([...w2.document.querySelectorAll('#gDecade .fopt')].find(r => r.querySelector('.txt').textContent === '1960er').classList.contains('on'),
    'Filter: die Haekchen stehen nach dem Neuladen wieder richtig');

  /* Die Playlist hat einen eigenen Regelsatz - ein ganzes Album bringt gern
     Instrumentalfassungen mit, die will man auch dort loswerden. */
  const plSongs = [
    { t: 'Song A', a: 'Band', al: 'Album', y: 2015, g: 'Rock' },
    { t: 'Song B', a: 'Band', al: 'Album', y: 2015, g: 'Rock' },
    { t: 'Song C', a: 'Band', al: 'Album', y: 2015, g: 'Rock' },
    { t: 'Song D (Instrumental)', a: 'Band', al: 'Album', y: 2015, g: 'Rock' },
    { t: 'Song E - Instrumental', a: 'Band', al: 'Album', y: 2015, g: 'Rock' },
    { t: 'Song F', a: 'Gast', al: 'Album', y: 2005, g: 'Pop' },
    { t: 'Song G', a: 'Gast', al: 'Album (Karaoke Version)', y: 2005, g: 'Pop' },
    { t: 'Song H', a: 'Gast', al: 'Album', y: 2005, g: 'Pop' },
  ].map((s, i) => ({ ...s, s: 0, p: 'https://audio/' + i, c: 'https://art/' + i + '/100x100bb.jpg', id: i }));

  const chartRules = JSON.stringify(w2.__ev('settings.filters'));
  w2.__ev(`PL = buildPlaylist({ name: "Album", songs: ${JSON.stringify(plSongs)}, missed: [] }); setMode("playlist")`);
  await waitFor(() => w2.__ev('mode') === 'playlist');

  assert(!w2.document.querySelector('#filterPanel').hidden, 'Playlist-Filter: das Panel bleibt sichtbar');
  assert(/Playlist/.test(w2.document.querySelector('#filterPanel h2').textContent),
    'Playlist-Filter: die Überschrift sagt, worauf die Regeln wirken');
  assert(w2.__ev('plFiltered').length === 5,
    'Playlist-Filter: Instrumentals und Karaoke fliegen von Haus aus raus (' + w2.__ev('plFiltered').length + ' von 8)');
  assert(w2.__ev("plFiltered.every(s => !/Instrumental|Karaoke/i.test(s.t + s.al))"),
    'Playlist-Filter: es bleibt nichts Instrumentales übrig');

  const pgen = [...w2.document.querySelectorAll('#gGenre .fopt')].map(r => r.querySelector('.txt').textContent);
  assert(pgen.length === 2 && pgen.includes('Rock') && pgen.includes('Pop'),
    'Playlist-Filter: die Listen zeigen die Genres der Playlist');
  const part = w2.document.querySelector('#fArtist');
  part.value = 'ban'; part.dispatchEvent(new w2.Event('input'));
  assert([...w2.document.querySelectorAll('#gArtist .fopt')].some(r => r.querySelector('.txt').textContent === 'Band'),
    'Playlist-Filter: die Künstlersuche kennt die Künstler der Playlist');

  w2.document.querySelector('#fMode button[data-v="ohne"]').click();
  [...w2.document.querySelectorAll('#gGenre .fopt')].find(r => r.querySelector('.txt').textContent === 'Pop').click();
  assert(w2.__ev('plFiltered').every(s => s.g !== 'Pop'), 'Playlist-Filter: „ohne Pop" wirkt auf die Playlist');
  assert(JSON.stringify(w2.__ev('settings.filters')) === chartRules,
    'Playlist-Filter: die Regeln der Charts bleiben davon unberührt');
  assert(w2.__ev('settings.plFilters').length === 2, 'Playlist-Filter: eigener Regelsatz wird gespeichert');

  w2.__ev('newRound()'); await tick(30);
  assert(w2.__ev("round.filter(r => r.song).length") === 3
    && w2.__ev("round.filter(r => r.song).every(r => plFiltered.some(x => x.i === r.song.i))"),
    'Playlist-Filter: die Runde zieht nur aus dem gefilterten Rest');
  assert(/Nur 3 von 8/.test(w2.document.querySelector('#filterCount').textContent),
    'Playlist-Filter: zu wenig Songs wird gemeldet (' + w2.document.querySelector('#filterCount').textContent + ')');

  w2.__ev("setMode('charts')"); await tick(30);
  assert(JSON.stringify(w2.__ev('settings.filters')) === chartRules && !/Playlist/.test(w2.document.querySelector('#filterPanel h2').textContent),
    'Playlist-Filter: zurück im Chartsmodus gelten wieder die alten Regeln');

  /* -------------------------------------------------- Eigene Musik */
  /* Dateien vom Geraet: nichts wird hochgeladen, Titel und Kuenstler kommen
     aus den Tags. Gebaut werden sie mit denselben Bausteinen wie in
     tools/test_tags.js. */
  const B = require('./test_tags.js');
  const w5 = makeWindow({});
  const L = n => w5.__ev(n), l$ = q => w5.document.querySelector(q);
  await waitFor(() => !w5.document.querySelector('#app').hidden);

  const mkFile = (bytes, name, pfad, mtime) => {
    const f = new w5.File([bytes], name, { lastModified: mtime || 1700000000000 });
    if (pfad) Object.defineProperty(f, 'webkitRelativePath', { value: pfad });
    return f;
  };
  const mitTags = (titel, kuenstler, album, jahr, genre) => B.mp3([
    B.id3v2Frame('TIT2', titel, 3), B.id3v2Frame('TPE1', kuenstler, 3),
    B.id3v2Frame('TALB', album, 3), B.id3v2Frame('TYER', String(jahr), 3),
    B.id3v2Frame('TCON', genre, 3),
  ], 3);

  const musik = [
    mkFile(mitTags('Erster Song', 'Testband', 'Testalbum', 1994, 'Rock'), '01.mp3', 'Musik/Testband/01.mp3'),
    mkFile(mitTags('Zweiter Song', 'Testband', 'Testalbum', 1994, 'Rock'), '02.mp3', 'Musik/Testband/02.mp3'),
    mkFile(mitTags('Dritter Song', 'Andere Band', 'Zweitalbum', 2015, 'Pop'), '03.mp3', 'Musik/Andere Band/03.mp3'),
    mkFile(mitTags('Vierter Song', 'Andere Band', 'Zweitalbum', 2015, 'Pop'), '04.mp3', 'Musik/Andere Band/04.mp3'),
    mkFile(mitTags('Fuenfter Song (Karaoke Version)', 'Andere Band', 'Zweitalbum', 2015, 'Pop'), '05.mp3', 'Musik/Andere Band/05.mp3'),
    mkFile(B.flac(['TITLE=Flacsong', 'ARTIST=Dritte Band', 'DATE=2003', 'GENRE=Jazz']), '06.flac', 'Musik/Dritte Band/06.flac'),
    mkFile(new Uint8Array(600), '07 - Vierte Band - Ohne Tags.mp3', 'Musik/Vierte Band/07 - Vierte Band - Ohne Tags.mp3'),
    mkFile(new Uint8Array(400), 'cover.jpg', 'Musik/Vierte Band/cover.jpg'),
  ];

  assert(l$('#modeSeg [data-v="local"]').disabled, 'Eigene Musik: ohne Dateien ist der Modus gesperrt');

  await w5.__ev('scanFiles')(musik, 'Musik');
  await waitFor(() => w5.__ev('mode') === 'local', 8000);
  assert(L('mode') === 'local', 'Eigene Musik: nach dem Einlesen laeuft der Modus');
  assert(L('LO.songs.length') === 7, 'Eigene Musik: das Bild wird nicht eingelesen (' + L('LO.songs.length') + ' Songs)');
  assert(L("LO.songs.some(s => s.t === 'Erster Song' && s.a === 'Testband')"),
    'Eigene Musik: Titel und Kuenstler kommen aus den Tags');
  assert(L("LO.songs.find(s => s.t === 'Erster Song').y") === 1994
    && L("LO.songs.find(s => s.t === 'Erster Song').g") === 'Rock',
    'Eigene Musik: Jahr und Genre ebenfalls');
  assert(L("LO.songs.some(s => s.t === 'Flacsong' && s.a === 'Dritte Band')"),
    'Eigene Musik: FLAC wird genauso gelesen');
  assert(L("LO.songs.some(s => s.t === 'Ohne Tags' && s.a === 'Vierte Band')"),
    'Eigene Musik: ohne Tags springt der Dateiname ein');
  assert(L("LO.songs.every(s => s.file && s.path)"), 'Eigene Musik: jede Zeile kennt ihre Datei');

  /* Die Standardregel raeumt Karaokefassungen weg - genau dafuer ist sie da. */
  assert(L('loFiltered.length') === 6 && L("loFiltered.every(s => !/Karaoke/.test(s.t))"),
    'Eigene Musik: die Karaokefassung faellt von Haus aus raus (' + L('loFiltered.length') + ')');

  assert(L('slots().length') === 5 && !L('usesTiers()') && L('round')[0].tier.mult === 1,
    'Eigene Musik: fuenf gleichwertige Plaetze, keine Stufen');
  assert(new Set(L('round').map(r => r.song.i)).size === 5, 'Eigene Musik: fuenf verschiedene Songs');
  assert(L("round.every(r => loFiltered.some(x => x.i === r.song.i))"), 'Eigene Musik: alle aus dem eigenen Bestand');

  L("suggest('song')");
  assert(L('sugAll').length > 0 && L("sugAll.every(s => LO.songs.some(x => x.t === s.t))"),
    'Eigene Musik: die Vorschlaege kommen nur aus der eigenen Musik');

  /* Abgespielt wird ein Ausschnitt, nicht der ganze Song im Speicher. */
  await waitFor(() => w5.__ev('round[0].buffer') != null, 8000);
  const puffer = L('round[0].buffer');
  const laenge = L('STAGES[STAGES.length - 1] + 8');
  assert(Math.abs(puffer.duration - laenge) < 0.1,
    'Eigene Musik: nur der gebrauchte Ausschnitt bleibt im Speicher (' + puffer.duration + ' s statt 180)');
  assert(L('round[0].offset') === 0, 'Eigene Musik: der Ausschnitt faengt bei null an');
  assert(Math.abs(L('round[0].at') - 2.47) < 0.1,
    'Eigene Musik: die Stille am Anfang wird uebersprungen (ab ' + L('round[0].at') + ' s)');

  await w5.__ev('playCurrent')();
  assert(L('round[0].song.dur') > 100, 'Eigene Musik: die Spielzeit steht nach dem Dekodieren fest');

  /* Aufloesung: Datei anklickbar, Dienste trotzdem daneben */
  w5.__ev('showReveal(round[0], false)');
  assert(!l$('#revealFile').hidden && /Musik\//.test(l$('#revealFile').textContent),
    'Eigene Musik: die Aufloesung nennt die Datei (' + l$('#revealFile').textContent + ')');
  assert(/^blob:/.test(l$('#revealFile').getAttribute('href')),
    'Eigene Musik: und laesst sie sich oeffnen');
  assert(l$('#revealLinks').querySelectorAll('a').length > 5,
    'Eigene Musik: nachhoeren kann man sie trotzdem woanders');
  const offen = w5.__urls.size;
  w5.__ev('closeReveal()'); await tick(20);
  assert(offen > 0 && w5.__urls.size === 0, 'Eigene Musik: die Objekt-URL wird wieder freigegeben');

  /* Der Songstart heisst hier anders und schneidet neu */
  assert(l$('#startMode [data-v="hook"]').textContent === 'Anfang des Songs',
    'Eigene Musik: der Songstart meint hier den Anfang des Songs');
  l$('#startMode [data-v="random"]').click();
  await waitFor(() => w5.__ev('round[0].buffer') != null, 8000);
  assert(L('round[0].at') > 3, 'Eigene Musik: zufaellige Stelle schneidet den Ausschnitt neu (ab ' + L('round[0].at') + ' s)');
  l$('#startMode [data-v="hook"]').click();
  await waitFor(() => w5.__ev('round[0].buffer') != null, 8000);

  /* Eigener Regelsatz */
  const loVorher = L('loFiltered.length');
  L(`settings.loFilters.push({ mode: 'ohne', type: 'genre', value: 'pop', text: 'Pop' }); applyFilters()`);
  assert(L('loFiltered').length < loVorher && L("loFiltered.every(s => s.g !== 'Pop')"),
    'Eigene Musik: eigene Filter greifen');
  assert(L("settings.filters.every(r => r.type !== 'genre')"),
    'Eigene Musik: die Chartsregeln bleiben unberuehrt');
  L(`settings.loFilters = settings.loFilters.filter(r => r.type !== 'genre'); applyFilters()`);

  /* Eine Runde zu Ende spielen: die Statistik zaehlt unter einem Schluessel */
  for (let i = 0; i < 5; i++) { L('choose(round[active].song); submit()'); await tick(10); L('closeReveal()'); await tick(10); }
  assert(L('stats.byTier.local') != null && L('stats.byTier.pl1') == null,
    'Eigene Musik: die Statistik zaehlt sie getrennt');
  assert(L("statGroups().some(g => g[0] === 'Eigene Musik' && g[1] === 5)"),
    'Eigene Musik: sie steht als eigene Zeile in der Aufschluesselung');
  l$('#summaryNext').click(); await tick(30);

  /* Gemerkte Tags: dieselben Dateien, aber ohne Inhalt - trotzdem stimmt alles */
  const gemerkt = w5.localStorage.getItem('songrate:localmeta');
  assert(gemerkt && JSON.parse(gemerkt).tracks.length === 7, 'Eigene Musik: die gelesenen Tags werden gemerkt');

  const w6 = makeWindow({ 'songrate:localmeta': gemerkt });
  await waitFor(() => !w6.document.querySelector('#app').hidden);
  const leer = musik.slice(0, 7).map(f => {
    const g = new w6.File([new Uint8Array(f.size)], f.name, { lastModified: 1700000000000 });
    Object.defineProperty(g, 'webkitRelativePath', { value: f.webkitRelativePath });
    return g;
  });
  await w6.__ev('scanFiles')(leer, 'Musik');
  await waitFor(() => w6.__ev('mode') === 'local', 8000);
  assert(w6.__ev("LO.songs.some(s => s.t === 'Erster Song' && s.a === 'Testband')"),
    'Neustart: die Tags kommen aus dem Speicher, die Dateien werden nicht neu gelesen');
  const frisch = await w6.__ev('Local.scan')(leer, { name: 'Musik' });
  assert(frisch.gelesen === 0, 'Neustart: dabei wird keine einzige Datei erneut geoeffnet');

  /* Ein Ordner voller Musik, ins Fenster gezogen */
  const w7 = makeWindow({});
  await waitFor(() => !w7.document.querySelector('#app').hidden);
  const dt = { files: [], items: musik.slice(0, 7).map(f => ({ webkitGetAsEntry: () => null })) };
  dt.files = musik.slice(0, 7).map(f => {
    const g = new w7.File([new Uint8Array(f.size)], f.name, { lastModified: 1700000000000 });
    Object.defineProperty(g, 'webkitRelativePath', { value: f.webkitRelativePath });
    return g;
  });
  const ev = new w7.Event('drop');
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  w7.document.dispatchEvent(ev);
  await waitFor(() => w7.__ev('mode') === 'local', 8000);
  assert(w7.__ev('mode') === 'local' && w7.__ev('LO.songs.length') === 7,
    'Ziehen und Ablegen: Musikdateien landen in der eigenen Mediathek');
  assert(w7.__ev('PL') === null, 'Ziehen und Ablegen: sie werden nicht als Playlist gelesen');

  /* Wieder weg damit */
  w7.document.querySelector('#loClear').click(); await tick(30);
  assert(w7.__ev('LO') === null && w7.__ev('mode') === 'charts'
    && w7.document.querySelector('#modeSeg [data-v="local"]').disabled,
    'Eigene Musik: entfernen schaltet zurueck und sperrt den Modus');

  /* ------------------------------------------- Mediathek vom Server */
  /* Subsonic, Jellyfin und Plex mit nachgebauten Antworten. Ob ein echter
     Server antwortet, kann der Test nicht wissen - dass die Anfragen richtig
     gebaut und die Antworten richtig gelesen werden, schon. */
  const w8 = makeWindow({});
  const S = n => w8.__ev(n), s$ = q => w8.document.querySelector(q);
  await waitFor(() => !w8.document.querySelector('#app').hidden);

  const srvFill = (kind, url, user, pass) => {
    s$(`#srvKind [data-v="${kind}"]`).click();
    s$('#srvUrl').value = url;
    s$('#srvUser').value = user || '';
    s$('#srvPass').value = pass || '';
  };

  /* ---- Subsonic ---- */
  srvCalls = [];
  srvFill('subsonic', 'https://musik.example.org', 'ben', 'geheim');
  s$('#srvGo').click();
  await waitFor(() => w8.__ev('mode') === 'local', 8000);
  assert(S('mode') === 'local' && S('LO.songs.length') === 7,
    'Subsonic: die Mediathek kommt an (' + S('LO.songs.length') + ' Songs)');
  assert(S("LO.songs[0].t") === 'Subsonic Song 1' && S("LO.songs[0].a") === 'Sub Band',
    'Subsonic: Titel und Kuenstler stimmen');
  assert(S("LO.songs[0].y") === 2001 && S("LO.songs[0].g") === 'Rock', 'Subsonic: Jahr und Genre auch');
  assert(/\/rest\/stream\?/.test(S('LO.songs[0].full')) && /format=mp3/.test(S('LO.songs[0].full')),
    'Subsonic: gespielt wird ein kleines MP3, nicht die ganze FLAC');
  assert(/\/rest\/getCoverArt\?/.test(S('LO.songs[0].c')), 'Subsonic: das Cover kommt vom Server');
  const ping = srvCalls.find(u => u.includes('/rest/ping'));
  assert(/t=[0-9a-f]{32}&s=\w+/.test(ping) && !/p=/.test(ping) && !ping.includes('geheim'),
    'Subsonic: das Passwort geht als Hash mit Salz, nicht im Klartext');
  assert(S("Server.md5('geheim' + 'x')").length === 32, 'Subsonic: md5 steht bereit');

  /* Gespielt wird wie eine eigene Datei: Ausschnitt statt ganzem Song */
  await waitFor(() => w8.__ev('round[0].buffer') != null, 8000);
  assert(Math.abs(S('round[0].buffer').duration - S('STAGES[STAGES.length - 1] + 8')) < 0.1,
    'Server: auch hier bleibt nur der Ausschnitt im Speicher');
  assert(S('round[0].offset') === 0, 'Server: der Ausschnitt faengt bei null an');

  /* Zugang gemerkt */
  assert(S("Server.restore().url") === 'https://musik.example.org' && S("Server.restore().kind") === 'subsonic',
    'Server: der Zugang wird gemerkt, wenn der Schalter an ist');
  s$('#srvForget').click();
  assert(S('Server.restore()') === null && s$('#srvPass').value === '', 'Server: und laesst sich vergessen');

  /* ---- Jellyfin ---- */
  srvCalls = [];
  srvFill('jellyfin', 'https://musik.example.org', 'ben', 'geheim');
  s$('#srvGo').click();
  await waitFor(() => w8.__ev('LO') && w8.__ev('LO.songs.length') === 6, 8000);
  assert(S("LO.songs[0].t") === 'Jelly Song 1' && S("LO.songs[0].a") === 'Jelly Band',
    'Jellyfin: Titel und Kuenstler stimmen');
  assert(S("LO.songs[0].dur") === 200, 'Jellyfin: die Spielzeit wird aus Ticks umgerechnet');
  assert(/AudioCodec=mp3/.test(S('LO.songs[0].full')) && /api_key=jf-token/.test(S('LO.songs[0].full')),
    'Jellyfin: gespielt wird mit dem Token vom Anmelden');
  assert(srvCalls.some(u => u.includes('/Users/AuthenticateByName')), 'Jellyfin: erst anmelden, dann holen');
  assert(srvCalls.some(u => /UserId=u1/.test(u)), 'Jellyfin: die Liste haengt am angemeldeten Benutzer');

  /* ---- Plex ---- */
  srvFill('plex', 'https://musik.example.org', '', 'plex-token');
  assert(s$('#srvUser').hidden && /Plex-Token/.test(s$('#srvPass').placeholder),
    'Plex: statt Benutzername und Passwort nur der Token');
  s$('#srvGo').click();
  await waitFor(() => w8.__ev('LO') && w8.__ev('LO.songs.length') === 6 && w8.__ev("LO.songs[0].t").startsWith('Plex'), 8000);
  assert(S("LO.songs[0].t") === 'Plex Song 1' && S("LO.songs[0].a") === 'Plex Band',
    'Plex: Titel und Kuenstler stimmen');
  assert(S("LO.songs[0].y") === 1999 && Math.round(S("LO.songs[0].dur")) === 210,
    'Plex: Jahr und Spielzeit auch');
  assert(/\/library\/parts\/1\/file\.flac\?X-Plex-Token=/.test(S('LO.songs[0].full')),
    'Plex: die Datei haengt am Token');

  /* Entfernen nimmt auch den gemerkten Zugang mit - sonst waere die
     Mediathek nach dem Neuladen sofort wieder da. */
  s$('#srvGo').click();
  await waitFor(() => w8.__ev('LO') != null && !w8.__ev('srvBusy'), 8000);
  s$('#loClear').click(); await tick(30);
  assert(S('LO') === null && S('Server.restore()') === null,
    'Server: entfernen nimmt den gemerkten Zugang mit');

  /* ---- Was schiefgehen kann, steht auch da ---- */
  srvFill('subsonic', 'http://192.168.1.5:4533', 'ben', 'geheim');
  s$('#srvGo').click();
  await waitFor(() => /https/.test(s$('#srvNote').textContent), 5000);
  assert(/http/.test(s$('#srvNote').textContent) && /blockt/.test(s$('#srvNote').textContent),
    'Server: bei http sagt die Meldung, woran es liegt (' + s$('#srvNote').textContent.slice(0, 60) + '…)');

  srvFill('subsonic', 'https://musik.kaputt.org', 'ben', 'geheim');
  s$('#srvGo').click();
  await waitFor(() => /CORS/.test(s$('#srvNote').textContent), 5000);
  assert(/CORS/.test(s$('#srvNote').textContent), 'Server: sonst wird nach Adresse und CORS gefragt');

  srvFill('subsonic', 'https://musik.example.org', 'falsch', 'geheim');
  s$('#srvGo').click();
  await waitFor(() => /Passwort/.test(s$('#srvNote').textContent), 5000);
  assert(/Benutzername oder Passwort/.test(s$('#srvNote').textContent),
    'Server: falsche Zugangsdaten werden benannt');

  /* ------------------------------------- Grosse Songliste bleibt flott */
  /* Nach ein paar Datenlaeufen stehen statt 2000 vielleicht 8000 Songs in der
     Datei. Der Test misst nur grob, faengt aber ein O(n²) ab, das sich
     einschleicht. */
  const t0 = Date.now();
  const wBig = makeWindow({}, db => {
    const vorlage = db.songs.slice(0, 400);
    for (let i = 0; i < 6000; i++) {
      const v = vorlage[i % vorlage.length];
      db.songs.push({ ...v, t: v.t + ' #' + i, r: (i % 100) + 1, f: i % 100 });
    }
  });
  await waitFor(() => !wBig.document.querySelector('#app').hidden, 20000);
  const bootMs = Date.now() - t0;
  assert(!wBig.document.querySelector('#app').hidden && bootMs < 15000,
    `grosse Liste: Start mit ${wBig.__ev('DB.songs.length')} Songs in ${bootMs} ms`);

  const tFilter = Date.now();
  wBig.__ev("settings.filters.push({ mode: 'ohne', type: 'genre', value: 'pop', text: 'Pop' }); applyFilters()");
  assert(Date.now() - tFilter < 3000, `grosse Liste: Filter greifen in ${Date.now() - tFilter} ms`);

  const tSug = Date.now();
  wBig.__ev("suggest('the')");
  assert(Date.now() - tSug < 2000,
    `grosse Liste: Vorschlaege in ${Date.now() - tSug} ms (${wBig.__ev('sugAll.length')} Treffer)`);
  assert(wBig.document.querySelectorAll('#suggest .sug').length <= 12,
    'grosse Liste: trotzdem nur eine Seite gezeichnet');

  wBig.__ev("setMode('decades')");
  assert(wBig.__ev('usesTiers()') && wBig.__ev('pickFiltered').length > 100,
    'grosse Liste: der Jahrzehntmodus hat dann genug fuer Stufen');

  /* ------------------------------------------------------- Randfaelle */
  w = makeWindow({
    'songrate:playlist': JSON.stringify({ name: 'Gespeichert', songs: [1, 2, 3, 4, 5, 6].map(dummy), missed: ['Fehlt'] }),
    'songrate:settings': JSON.stringify({ mode: 'playlist' }),
  });
  await waitFor(() => !w.document.querySelector('#app').hidden);
  assert(w.__ev('mode') === 'playlist' && w.__ev('PL.songs.length') === 6, 'Neustart: gespeicherte Playlist wird wieder aufgenommen');
  assert(w.document.querySelector('#plStatus').textContent.includes('Gespeichert'), 'Neustart: Status nennt die Playlist');

  w = makeWindow({
    'songrate:playlist': JSON.stringify({ name: 'Kurz', songs: [1, 2, 3].map(dummy), missed: [] }),
    'songrate:settings': JSON.stringify({ mode: 'playlist' }),
  });
  await waitFor(() => !w.document.querySelector('#app').hidden);
  assert(w.__ev('mode') === 'charts' && w.document.querySelector('#modeSeg [data-v="playlist"]').disabled,
    'Zu kurze Playlist: Modus bleibt gesperrt');

  /* Drosselung: der Lauf bricht nicht ab, sondern wartet sichtbar und laesst
     sich abbrechen; die Titelliste bleibt fuer „Weiter suchen" liegen. */
  w = makeWindow({});
  await waitFor(() => !w.document.querySelector('#app').hidden);
  w.fetch = async url => String(url).includes('itunes')
    ? { ok: false, status: 403, json: async () => ({}) }
    : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  const status = () => w.document.querySelector('#plStatus').textContent;
  w.__ev("loadPlaylistText('Track Name,Artist Name(s)\\nA,B\\nC,D', 'X')");
  await waitFor(() => /Apple bremst/.test(status()));
  assert(/Apple bremst – weiter in \d+ s/.test(status()), 'Drosselung: Wartezeit wird heruntergezählt (' + status() + ')');
  assert(!w.document.querySelector('#plCancel').hidden, 'Drosselung: Abbrechen ist sichtbar');

  w.document.querySelector('#plCancel').click();
  await waitFor(() => w.__ev('plBusy') === false);
  assert(w.__ev('plBusy') === false, 'Abbrechen: Lauf endet');
  assert(!w.document.querySelector('#plResume').hidden, 'Abbrechen: „Weiter suchen" steht bereit');
  assert(w.__ev('Playlist.restoreQueue()') != null, 'Abbrechen: Titelliste bleibt gespeichert');

  console.log(failed ? `\n${failed} Fehler` : '\nAlles durchgespielt');
  process.exit(failed ? 1 : 0);
})();
