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
  w.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
    createBufferSource() { const s = { buffer: null, connect() {}, start() {}, stop() {}, onended: null }; setTimeout(() => s.onended && s.onended(), 0); return s; }
    decodeAudioData() { return Promise.resolve({ duration: 30 }); }
    resume() {}
  };

  Object.entries(store || {}).forEach(([k, v]) => w.localStorage.setItem(k, v));

  w.fetch = async url => {
    url = String(url);
    if (url.includes('songs.json')) {
      const db = JSON.parse(read('data/songs.json'));
      if (patchDb) patchDb(db);
      return { ok: true, status: 200, json: async () => db };
    }
    if (url.includes('itunes.apple.com/search')) {
      itunesCalls++;
      const term = sortKey(decodeURIComponent(url.split('term=')[1]));
      const hit = Object.entries(CATALOG).find(([k]) => sortKey(k) === term);
      return { ok: true, status: 200, json: async () => ({ results: hit ? [hit[1]] : [] }) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };  /* Preview */
  };

  w.eval(['assets/audio.js', 'assets/playlist.js', 'assets/filters.js', 'assets/app.js'].map(read).join('\n;\n')
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
  assert(G('stats.byTier.playlist') != null && G('stats.byTier.pl1') == null, 'Playlist: Statistik unter einem Schluessel');
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
  const easyMin = G("Math.min(...byTier.easy.map(s => s.s))");
  const impMax = G("Math.max(...byTier.impossible.map(s => s.s))");
  assert(easyMin >= impMax, 'Jahrzehnte: Easy sind die bekanntesten Songs des Jahrzehnts');

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
  assert(!G("listFor('decades').map(o => o.value)").includes(1950), 'Jahrzehnte: die 1950er mit einem Song fallen weg');
  assert($('#gDecade').hidden, 'Jahrzehnte: die Jahrzehnt-Liste im Filterpanel ist hier ausgeblendet');

  /* Ein duenn besetztes Jahrzehnt wird ohne Stufen gespielt */
  G('settings.decade = 1960; applyFilters(); renderSlots(); newRound()'); await tick(40);
  assert(G('(currentPick()||{}).value') === 1960, 'Jahrzehnte: die 1960er sind waehlbar');
  assert(!G('usesTiers()') && G('slots()').length === 5 && G('round')[0].tier.mult === 1,
    'Jahrzehnte: zu wenige Songs -> fuenf zufaellige statt Stufen (' + G('pickFiltered').length + ')');
  assert(new Set(G('round').filter(r => r.song).map(r => r.song.i)).size === 5,
    'Jahrzehnte: dabei wiederholt sich kein Song');
  assert(/ohne Stufen/.test($('#pickCount').textContent), 'Jahrzehnte: die Leiste sagt es dazu');
  assert($('#tierList').children.length === 5 && $('#tierList').children[0].textContent.includes('Song'),
    'Jahrzehnte: die Leiste links zeigt Plaetze statt Stufen');
  G('settings.decade = 2010; applyFilters(); renderSlots(); newRound()'); await tick(40);
  assert(G('usesTiers()'), 'Jahrzehnte: ein grosses Jahrzehnt hat wieder Stufen');

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

  /* Bei Apple Music nachhoeren */
  G('showReveal(round[0], false)');
  assert(/music\.apple\.com\/de\/search\?term=/.test($('#revealLink').href),
    'Aufloesung: Link zu Apple Music mit Titel und Kuenstler');
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
    G(`settings.genre = ${JSON.stringify(tinyGenre)}; applyFilters(); renderSlots(); newRound()`);
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
  assert(!$('#stageBar').querySelector('.stage-seg.off'), 'Balken: keine ausgegrauten Kaesten mehr');
  $('#stageChips').children[0].click(); await tick(20);
  assert(segCount() === 5, 'Balken: eine abgeschaltete Stufe bekommt keinen eigenen Kasten');
  const widths = G('segmentWidths()');
  assert(Math.abs(widths[0] - G('logW(0)') - G('logW(1)')) < 1e-9,
    'Balken: ihre Breite geht an die naechste Stufe, die sie mitspielt');
  $('#stageChips').children[0].click(); await tick(20);
  assert(segCount() === 6, 'Balken: wieder eingeschaltet ist der Kasten zurueck');

  /* ------------------------------------------------- Suchfeld/Vorschlaege */
  const box = $('#suggest'), rows = () => box.querySelectorAll('.sug');
  const key = (k, opts) => $('#search').dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

  G("suggest('billie')");
  const hits = G('sugAll').length;
  assert(hits > 12, 'Vorschlaege: „billie" findet mehr als eine Seite (' + hits + ')');
  assert(G("sugAll.some(s => s.n === 'your power')"), 'Vorschlaege: auch Your Power ist dabei');
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

  /* Zu kleiner Pool warnt. Die 1960er haben ausserdem keine Impossible-Songs,
     die Stufe muss also Ersatz aus dem Rest bekommen. */
  add('nur', 'decade', '1960er');
  assert(F('filtered').length < 30 && $$('#filterCount').classList.contains('warn')
    && /Nur \d+ Songs/.test($$('#filterCount').textContent), 'Filter: kleiner Pool warnt (' + $$('#filterCount').textContent + ')');
  assert(F('byTier.impossible').length === 0, 'Filter: die 1960er lassen Impossible leer');

  F('newRound()'); await tick(30);
  const small = new Set(F('filtered').map(s => s.i));
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
