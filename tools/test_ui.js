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

function makeWindow(store) {
  const w = new JSDOM(read('index.html'), { runScripts: 'outside-only', url: 'https://example.org/' }).window;

  w.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, fillRect() {},
    set fillStyle(v) {}, set globalAlpha(v) {},
  });
  w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 8);
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
    if (url.includes('songs.json')) return { ok: true, status: 200, json: async () => JSON.parse(read('data/songs.json')) };
    if (url.includes('itunes.apple.com/search')) {
      itunesCalls++;
      const term = sortKey(decodeURIComponent(url.split('term=')[1]));
      const hit = Object.entries(CATALOG).find(([k]) => sortKey(k) === term);
      return { ok: true, status: 200, json: async () => ({ results: hit ? [hit[1]] : [] }) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };  /* Preview */
  };

  w.eval(['assets/audio.js', 'assets/playlist.js', 'assets/app.js'].map(read).join('\n;\n')
    + '\n;window.__ev = s => eval(s);');
  return w;
}

const dummy = n => ({ t: 'Song ' + n, a: 'Kuenstler ' + n, al: 'Album', y: 2020, g: 'Pop', s: 0, p: 'https://audio/' + n, c: 'https://art/' + n + '/100x100bb.jpg', id: n });

(async () => {
  /* ------------------------------------------------ Runde im Chartsmodus */
  let w = makeWindow({});
  const G = n => w.__ev(n), $ = s => w.document.querySelector(s);
  await tick(150);

  assert(!$('#app').hidden, 'Boot: App sichtbar');
  assert($('#tabs').children.length === 5, 'Boot: fuenf Reiter');
  assert(G('round').length === 5 && G('round').every(r => r.song), 'Boot: Runde mit fuenf Songs');

  await G('playCurrent()'); await tick(30);
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
  await G(`loadPlaylistText(${JSON.stringify(csv)}, 'Testliste')`); await tick(1500);

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
  await G(`loadPlaylistText(${JSON.stringify(csv)}, 'Testliste')`); await tick(400);
  assert(itunesCalls === calls, 'Playlist: zweiter Import kommt aus dem Cache');

  G("setMode('charts')"); await tick(30);
  assert(G('mode') === 'charts' && G('round')[0].tier.id === 'easy', 'Rueckschaltung in den Chartsmodus');

  $('#plClear').click(); await tick(10);
  assert(G('PL') === null && $('#modeSeg').children[1].disabled, 'Playlist entfernt: Modus wieder gesperrt');

  /* ------------------------------------------------------- Randfaelle */
  w = makeWindow({
    'songrate:playlist': JSON.stringify({ name: 'Gespeichert', songs: [1, 2, 3, 4, 5, 6].map(dummy), missed: ['Fehlt'] }),
    'songrate:settings': JSON.stringify({ mode: 'playlist' }),
  });
  await tick(150);
  assert(w.__ev('mode') === 'playlist' && w.__ev('PL.songs.length') === 6, 'Neustart: gespeicherte Playlist wird wieder aufgenommen');
  assert(w.document.querySelector('#plStatus').textContent.includes('Gespeichert'), 'Neustart: Status nennt die Playlist');

  w = makeWindow({
    'songrate:playlist': JSON.stringify({ name: 'Kurz', songs: [1, 2, 3].map(dummy), missed: [] }),
    'songrate:settings': JSON.stringify({ mode: 'playlist' }),
  });
  await tick(150);
  assert(w.__ev('mode') === 'charts' && w.document.querySelector('#modeSeg').children[1].disabled,
    'Zu kurze Playlist: Modus bleibt gesperrt');

  /* Drosselung: der Lauf bricht nicht ab, sondern wartet sichtbar und laesst
     sich abbrechen; die Titelliste bleibt fuer „Weiter suchen" liegen. */
  w = makeWindow({});
  await tick(150);
  w.fetch = async url => String(url).includes('itunes')
    ? { ok: false, status: 403, json: async () => ({}) }
    : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  const status = () => w.document.querySelector('#plStatus').textContent;
  w.__ev("loadPlaylistText('Track Name,Artist Name(s)\\nA,B\\nC,D', 'X')");
  await tick(1200);
  assert(/Apple bremst – weiter in \d+ s/.test(status()), 'Drosselung: Wartezeit wird heruntergezählt (' + status() + ')');
  assert(!w.document.querySelector('#plCancel').hidden, 'Drosselung: Abbrechen ist sichtbar');

  w.document.querySelector('#plCancel').click();
  await tick(1200);
  assert(w.__ev('plBusy') === false, 'Abbrechen: Lauf endet');
  assert(!w.document.querySelector('#plResume').hidden, 'Abbrechen: „Weiter suchen" steht bereit');
  assert(w.__ev('Playlist.restoreQueue()') != null, 'Abbrechen: Titelliste bleibt gespeichert');

  console.log(failed ? `\n${failed} Fehler` : '\nAlles durchgespielt');
  process.exit(failed ? 1 : 0);
})();
