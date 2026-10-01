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
/* Kein Song darf in einer schwereren Stufe stehen als ein weniger bekannter.
   Verglichen wird die Bekanntheit (pop): Streams, oder bei Songs aus den
   Jahrescharts die Schaetzung. */
const monotone = ev => ev(`(() => {
  let prevMin = Infinity;
  for (const t of TIERS) {
    const vals = byTier[t.id].map(popOf);
    if (!vals.length) continue;
    if (Math.max(...vals) > prevMin) return false;
    prevMin = Math.min(...vals);
  }
  return true;
})()`);
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
/* Songs, die nicht in songs.json stehen - an ihnen haengt die Suche bei
   Apple. Die Titel sind so gewaehlt, wie ein Spotify-Export sie liefert:
   mit „- 2005 Remaster", mehreren Kuenstlern und typografischem Apostroph. */
const EXTRA = [
  { trackName: 'Testlied', artistName: 'Mockband', collectionName: 'Mockalbum', releaseDate: '1983-01-01',
    primaryGenreName: 'Pop', previewUrl: 'https://audio/m1.m4a', artworkUrl100: 'https://art/m1/100x100bb.jpg', trackId: 31, isrc: 'DEMOC8300001' },
  { trackName: "Gänsehaut's Lied", artistName: 'JAY-Band', collectionName: 'Gans', releaseDate: '2009-01-01',
    primaryGenreName: 'Rock', previewUrl: 'https://audio/m2.m4a', artworkUrl100: 'https://art/m2/100x100bb.jpg', trackId: 32, isrc: 'DEMOC0900002' },
  /* Bei Apple heisst der Titel anders als in der Liste - ueber die Suche
     nicht zu finden, ueber die ISRC schon. */
  { trackName: 'Dieses Lied (Original Mix)', artistName: 'Anderer Name', collectionName: 'X', releaseDate: '2012-01-01',
    primaryGenreName: 'Pop', previewUrl: 'https://audio/m3.m4a', artworkUrl100: 'https://art/m3/100x100bb.jpg', trackId: 33, isrc: 'DEMOC1200003' },
];
let isrcBatchBroken = false;   /* Apple nimmt angeblich keine Liste */
let isrcCalls = [];
/* Apples Suche findet nur, was jedes Wort des Begriffs traegt. */
const nrm = x => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const appleSearch = (term, list) => {
  const words = nrm(term).split(' ').filter(Boolean);
  return list.filter(c => {
    const hay = ' ' + nrm(c.trackName + ' ' + c.artistName + ' ' + (c.collectionName || '')) + ' ';
    return words.length && words.every(w => hay.includes(' ' + w + ' '));
  });
};
let searchTerms = [];
let spotifyCalls = [];
let failSongs = false;       /* songs.json absichtlich scheitern lassen */
let itunesCalls = 0;
let srvCalls = [];
let odesliCalls = [];

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

function makeWindow(store, patchDb, url) {
  const w = new JSDOM(read('index.html'), { runScripts: 'outside-only', url: url || 'https://example.org/' }).window;
  /* PKCE braucht crypto.subtle und TextEncoder - jsdom bringt sie nicht
     immer mit, Node schon. */
  const webcrypto = require('crypto').webcrypto;
  if (!w.crypto || !w.crypto.subtle) Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true });
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;

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

  w.fetch = async (url, opts) => {
    url = String(url);
    /* Der Browser bricht http-Anfragen aus einer https-Seite ab, ohne zu
       fragen - hier genauso. */
    if (url.startsWith('http://')) { srvCalls.push(url); throw new TypeError('Failed to fetch'); }
    if (url.includes('songs.json')) {
      if (failSongs) return { ok: false, status: 500, json: async () => ({}) };
      const db = JSON.parse(read('data/songs.json'));
      if (patchDb) patchDb(db);
      return { ok: true, status: 200, json: async () => db };
    }
    if (url.includes('itunes.apple.com/search') && url.includes('entity=musicArtist')) {
      itunesCalls++;
      const term = decodeURIComponent(url.split('term=')[1].split('&')[0]).toLowerCase();
      const alle = [{ artistId: 1, artistName: 'Testband', primaryGenreName: 'Rock' },
                    { artistId: 2, artistName: 'Testband Zwei', primaryGenreName: 'Pop' },
                    { artistId: 3, artistName: 'Stapelband', primaryGenreName: 'Rock' }];
      const treffer = alle.filter(a => a.artistName.toLowerCase().includes(term.replace(/\+/g, ' ')));
      return { ok: true, status: 200, json: async () => ({ results: treffer }) };
    }
    if (url.includes('itunes.apple.com/search') && url.includes('attribute=artistTerm')
        && /term=stapelband/i.test(url)) {
      itunesCalls++;
      searchTerms.push('katalog:stapelband');
      const st = (name, id, extra) => ({ trackName: name, artistName: 'Stapelband', collectionName: 'Stapel',
        releaseDate: '2012-01-01', primaryGenreName: 'Rock', trackId: id, previewUrl: 'https://audio/st' + id,
        artworkUrl100: 'https://art/st/100x100bb.jpg', ...extra });
      return { ok: true, status: 200, json: async () => ({ results: [
        st('Eins', 41), st('Zwei', 42), st('Drei (Live)', 43), st('Drei', 44), st('Vier', 45, { previewUrl: undefined }),
      ] }) };
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
      /* Eine Clubfassung, die es auch schlicht gibt - am Anfang nicht zu
         unterscheiden, also raus. */
      songs.push({ trackName: 'Katalogsong 2 [Extended Club]', artistName: 'Testband',
                   collectionName: 'Album', releaseDate: '2015-06-01', trackId: 903,
                   previewUrl: 'https://audio/club' });
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
        /* Der Fall aus dem Spiel: ein fremder Song, der den gesuchten
           Kuenstler nur im Titel nennt. */
        { trackName: 'Testband & Wer Anders', artistName: 'Dritte Band', collectionName: 'Y',
          releaseDate: '2022-01-01', trackId: 502, previewUrl: 'https://audio/g3' },
      ] }) };
    }
    /* ---- Spotify: Anmeldung und Web API ---- */
    if (url.includes('accounts.spotify.com/api/token')) {
      const body = new URLSearchParams(opts && opts.body || '');
      spotifyCalls.push('token:' + body.get('grant_type'));
      if (body.get('grant_type') === 'authorization_code'
          && (body.get('code') !== 'abc' || !body.get('code_verifier') || body.get('client_id') !== 'test-client')) {
        return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) };
      }
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok-' + spotifyCalls.length,
        token_type: 'Bearer', expires_in: 3600, refresh_token: 'ref-1' }) };
    }
    if (url.includes('api.spotify.com/v1/')) {
      const pfad = url.split('/v1/')[1];
      spotifyCalls.push(pfad.split('?')[0]);
      if (!opts || !opts.headers || !/^Bearer tok-/.test(opts.headers.Authorization)) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      const json = x => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => x });
      if (pfad.startsWith('me/playlists')) {
        return json({ next: null, items: [
          { id: 'pl1', name: 'Meine Klassiker', owner: { id: 'u1', display_name: 'Ich' }, items: { total: 3 } },
          { id: 'pl2', name: 'Gemeinsam', owner: { id: 'u9' }, collaborative: true, tracks: { total: 1 } },
          { id: 'pl3', name: 'Discover Weekly', owner: { id: 'spotify', display_name: 'Spotify' }, items: { total: 30 } },
        ] });
      }
      if (pfad.startsWith('me/tracks')) {
        return json({ next: null, total: 1, items: [{ track: { type: 'track', name: 'Hello', artists: [{ name: 'Adele' }], album: { name: '25' } } }] });
      }
      if (pfad === 'me') return json({ id: 'u1', display_name: 'Ich' });
      if (pfad.startsWith('playlists/pl1/items')) {
        const off = +(/offset=(\d+)/.exec(pfad) || [0, 0])[1];
        /* Zwei Seiten, wie Spotify sie liefert - mit `next`. Seit Maerz 2026
           steht der Song unter `item`, nicht mehr unter `track`. */
        if (!off) {
          return json({ total: 4, next: 'https://api.spotify.com/v1/playlists/pl1/items?offset=2&limit=50', items: [
            { item: { type: 'track', name: 'Blinding Lights', artists: [{ name: 'The Weeknd' }], album: { name: 'After Hours' } } },
            { item: { type: 'episode', name: 'Ein Podcast' } },
          ] });
        }
        return json({ total: 4, next: null, items: [
          { item: { type: 'track', id: '5bcTCxgc7xVfSaMV3RuVke', name: 'September', artists: [{ name: 'Earth, Wind & Fire' }], album: { name: 'X' } } },
          { item: { type: 'track', name: 'Levitating (feat. DaBaby)', artists: [{ name: 'Dua Lipa' }, { name: 'DaBaby' }], album: { name: 'FN' } } },
        ] });
      }
      if (pfad.startsWith('playlists/pl3/items')) return { ok: false, status: 403, json: async () => ({}) };
      if (pfad.startsWith('playlists/pl4/items')) {
        return json({ total: 2, next: 'https://evil.example/steal?token', items: [
          { item: { type: 'track', name: 'Hello', artists: [{ name: 'Adele' }], album: { name: '25' } } } ] });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }

    /* ---- song.link: die API ist seit Herbst 2025 dicht ---- */
    if (url.includes('api.song.link')) {
      odesliCalls.push(url);
      return { ok: false, status: 401, json: async () => ({ statusCode: 401, code: 'PUBLIC_API_ACCESS_DEPRECATED' }) };
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

    /* Alben suchen und ihre Titel holen - fuer "einzeln hinzufuegen" und den
       Umweg ueber das Album. Der Begriff entscheidet, was zurueckkommt. */
    if (url.includes('itunes.apple.com/search') && url.includes('entity=album')) {
      itunesCalls++;
      /* URLSearchParams schreibt Leerzeichen als Plus. */
      const term = decodeURIComponent(url.split('term=')[1].split('&')[0]).replace(/\+/g, ' ');
      searchTerms.push('album:' + term);
      const alben = [
        { collectionId: 77, collectionName: 'Loud', artistName: 'Rihanna',
          releaseDate: '2010-11-12', primaryGenreName: 'Pop', trackCount: 3,
          artworkUrl100: 'https://art/loud/100x100bb.jpg' },
        { collectionId: 78, collectionName: 'Ohne Hoerproben', artistName: 'Niemand', trackCount: 2 },
        /* Das Album mit dem expliziten Titel, den die Songsuche verschweigt. */
        { collectionId: 90, collectionName: 'Vol.1', artistName: 'Mockband',
          releaseDate: '2017-06-30', primaryGenreName: 'Pop', trackCount: 2,
          artworkUrl100: 'https://art/vol1/100x100bb.jpg' },
      ];
      const treffer = /vol/i.test(term) ? alben.slice(2) : /nirgends|gibts/i.test(term) ? [] : alben.slice(0, 2);
      return { ok: true, status: 200, json: async () => ({ results: treffer }) };
    }
    if (url.includes('itunes.apple.com/lookup') && url.includes('isrc=')) {
      itunesCalls++;
      const codes = decodeURIComponent(url.split('isrc=')[1].split('&')[0]).split(',');
      isrcCalls.push(codes.length);
      if (isrcBatchBroken && codes.length > 1) return { ok: true, status: 200, json: async () => ({ results: [] }) };
      const results = EXTRA.filter(e => codes.includes(e.isrc)).map(e => ({ ...e, wrapperType: 'track' }));
      return { ok: true, status: 200, json: async () => ({ results }) };
    }
    if (url.includes('itunes.apple.com/lookup')) {
      itunesCalls++;
      const id = +(/id=(\d+)/.exec(url) || [0, 0])[1];
      /* Lookup ueber die Kuenstler-ID: kennt auch, was die Suche verschweigt. */
      if (id === 1 && url.includes('entity=song')) {
        return { ok: true, status: 200, json: async () => ({ results: [
          { wrapperType: 'artist', artistId: 1 },
          { wrapperType: 'track', trackName: 'Katalogsong 1', artistName: 'Testband', artistId: 1, collectionName: 'Album',
            releaseDate: '2015-01-01', primaryGenreName: 'Rock', trackId: 101, previewUrl: 'https://audio/k1', artworkUrl100: 'https://art/k/100x100bb.jpg' },
          { wrapperType: 'track', trackName: 'Verschwiegener Song', artistName: 'Testband', artistId: 1, collectionName: 'Album',
            releaseDate: '2017-01-01', primaryGenreName: 'Rock', trackId: 150, previewUrl: 'https://audio/k150', artworkUrl100: 'https://art/k/100x100bb.jpg' },
        ] }) };
      }
      if (id === 3 && url.includes('entity=song')) {
        return { ok: true, status: 200, json: async () => ({ results: [
          { wrapperType: 'artist', artistId: 3 },
          { wrapperType: 'track', trackName: 'Vier', artistName: 'Stapelband', artistId: 3, collectionName: 'Stapel',
            releaseDate: '2012-01-01', primaryGenreName: 'Rock', trackId: 46, previewUrl: 'https://audio/st46', artworkUrl100: 'https://art/st/100x100bb.jpg' },
        ] }) };
      }
      if (id === 90 && url.includes('entity=song')) {
        return { ok: true, status: 200, json: async () => ({ results: [
          { wrapperType: 'collection', collectionId: 90 },
          { wrapperType: 'track', trackName: 'Braves Lied', artistName: 'Mockband', collectionName: 'Vol.1',
            releaseDate: '2017-06-30', primaryGenreName: 'Pop', trackId: 9000, trackExplicitness: 'notExplicit',
            previewUrl: 'https://audio/brav', artworkUrl100: 'https://art/expl/100x100bb.jpg' },
          { wrapperType: 'track', trackName: 'Explizites Lied', artistName: 'Mockband', collectionName: 'Vol.1',
            releaseDate: '2017-06-30', primaryGenreName: 'Pop', trackId: 9001, trackExplicitness: 'explicit',
            previewUrl: 'https://audio/expl1', artworkUrl100: 'https://art/expl/100x100bb.jpg' },
        ] }) };
      }
      if (id !== 77) return { ok: true, status: 200, json: async () => ({ results: [] }) };
      const t = i => ({ wrapperType: 'track', trackName: 'Loudsong ' + i, artistName: 'Rihanna',
                        collectionName: 'Loud', releaseDate: '2010-11-12', primaryGenreName: 'Pop',
                        trackId: 7700 + i, previewUrl: 'https://audio/loud' + i,
                        artworkUrl100: 'https://art/loud/100x100bb.jpg' });
      return { ok: true, status: 200, json: async () => ({ results: [
        { wrapperType: 'collection', collectionId: 77 }, t(1), t(2),
        { wrapperType: 'track', trackName: 'Ohne Probe', artistName: 'Rihanna', trackId: 7799 },
      ] }) };
    }
    /* Songsuche fuer "einzeln hinzufuegen": ein eigener Begriff, damit sie
       sich vom Aufloesen einer Importliste unterscheidet. */
    if (url.includes('itunes.apple.com/search') && /term=neuer/i.test(url)) {
      itunesCalls++;
      return { ok: true, status: 200, json: async () => ({ results: [
        { trackName: 'Neuer Song', artistName: 'Neue Band', collectionName: 'Neu',
          releaseDate: '2024-03-01', primaryGenreName: 'Rock', trackId: 4242,
          previewUrl: 'https://audio/neu', artworkUrl100: 'https://art/neu/100x100bb.jpg' },
        { trackName: 'Ohne Probe', artistName: 'Neue Band', trackId: 4243 },
      ] }) };
    }

    if (url.includes('itunes.apple.com/search')) {
      itunesCalls++;
      const term = decodeURIComponent(url.split('term=')[1].split('&')[0]);
      searchTerms.push(term);
      /* Zwei Arten von Scheitern, fuer die Erklaerung hinter dem ?-Knopf. */
      if (/kaputt/i.test(term)) throw new TypeError('Failed to fetch');
      if (/fuenfhundert/i.test(term)) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({
        results: appleSearch(term, [...Object.values(CATALOG), ...EXTRA]) }) };
    }
    /* Eine Hoerprobe, die nicht kommt - fuer die Meldung unter dem Knopf. */
    if (url.includes('audio/kaputt')) throw new TypeError('Failed to fetch');
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };  /* Preview */
  };

  w.eval(['assets/links.js', 'assets/tags.js', 'assets/local.js', 'assets/server.js',
    'assets/audio.js', 'assets/playlist.js', 'assets/spotify.js', 'assets/filters.js', 'assets/artist.js',
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
  await tick(600);
  assert($('#audioNote').textContent === '', 'Abspielen: laeuft der Ton, bleibt die Zeile darunter leer');

  /* Kein Ton: der Context haengt (iOS 'interrupted') - die Zeile sagt es. */
  G("Audio2.ensure().state = 'interrupted'");
  await G('playCurrent()');
  await tick(650);
  assert(/Kein Ton/.test($('#audioNote').textContent) && $('#audioNote .why')
    && /unterbrochen/.test($('#audioNote .why').title) && /AudioContext interrupted/.test($('#audioNote .why').title),
    'Abspielen: haengt der Tonkanal, steht es unter dem Knopf, mit Erklaerung (' + $('#audioNote').textContent + ')');
  G("Audio2.ensure().state = 'running'");
  await G('playCurrent()');
  await tick(650);
  assert($('#audioNote').textContent === '', 'Abspielen: laeuft er wieder, verschwindet die Zeile');

  /* Die Hoerprobe kommt nicht: Fehler mit Adresse, die Zeile bleibt bis zur naechsten Runde. */
  {
    const echt = G('round[0].song.p');
    G("round[0].buffer = null; round[0].swapped = true; round[0].song.p = 'https://audio/kaputt'");
    await G('playCurrent()');
    await waitFor(() => $('#audioNote .why'), 3000);
    assert(/nicht laden/.test($('#audioNote').textContent) && /audio\/kaputt/.test($('#audioNote .why').title)
      && /nicht angekommen/.test($('#audioNote .why').title),
      'Abspielen: eine fehlende Hoerprobe wird gemeldet und erklaert');
    G("round[0].song.p = " + JSON.stringify(echt) + "; round[0].error = false; round[0].swapped = false");
    G('newRound()'); await tick(30);
    assert($('#audioNote').textContent === '', 'Abspielen: die neue Runde raeumt die Zeile weg');
  }

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

  /* ----------------------------------------- Keine Wiederholungen */
  /* Die Liste der zuletzt gespielten haengt an Titel und Kuenstler, nicht an
     der Nummer im Pool - die verschiebt sich bei jedem Datenlauf. */
  G('newRound()'); await tick(30);
  const gespielt = G('round.map(r => r.song.t)');
  for (let i = 0; i < 5; i++) { G('choose(round[active].song); submit()'); await tick(10); G('closeReveal()'); await tick(10); }
  assert(G('recent').every(x => typeof x === 'string'),
    'Wiederholungen: gemerkt wird ein Schluessel aus Titel und Kuenstler');
  assert(gespielt.every(t => G('recent').some(k => k.startsWith(G('norm')(t) + '|'))),
    'Wiederholungen: die gerade gespielten stehen drin');
  $('#summaryNext').click(); await tick(30);

  const altStand = JSON.stringify([12, 34, 56]);
  const wAlt2 = makeWindow({ 'songrate:recent': altStand });
  await waitFor(() => !wAlt2.document.querySelector('#app').hidden);
  assert(wAlt2.__ev('recent').every(x => typeof x === 'string' && x.includes('|')),
    'Wiederholungen: alte Nummern werden verworfen, nicht als Schluessel gelesen');

  /* --------------------------------------------------- Ausklappbares */
  /* Neun Panels waeren eine Scrollstrecke. Zugeklappt steht das Wichtigste in
     der Zeile, aufgeklappt bleibt nur, was man wirklich braucht. */
  const panels = [...$('#app').querySelectorAll('details.panel')];
  assert(panels.length >= 8, 'Panels: die Seitenspalten klappen zu (' + panels.length + ')');
  assert(panels.every(d => !d.open), 'Panels: beim ersten Besuch ist alles zu');
  assert(!$('#modeSeg').closest('details'), 'Panels: der Modus bleibt immer sichtbar');
  const sumOf = k => $(`details.panel[data-k="${k}"] .psum`).textContent;
  assert(sumOf('service') === 'Apple Music', 'Panels: die Zeile nennt den Dienst');
  assert(/^Charts · \d+ Songs/.test(sumOf('filter')),
    'Panels: und worauf die Songauswahl wirkt (' + sumOf('filter') + ')');
  assert(sumOf('stages') === '6 von 6 · 0,01s–15s', 'Panels: und wie viele Stufen an sind (' + sumOf('stages') + ')');
  assert(sumOf('playlist') === 'nichts geladen' && sumOf('local') === 'nichts geladen',
    'Panels: leere Quellen sagen das');
  assert(/gestuft · Anfang · \d+ %/.test(sumOf('play')), 'Panels: Spielweise auf einen Blick (' + sumOf('play') + ')');

  const filterPanel = $('details.panel[data-k="filter"]');
  filterPanel.open = true;
  filterPanel.dispatchEvent(new w.Event('toggle'));
  assert(G('settings.open.filter') === true, 'Panels: aufgeklappt wird gemerkt');

  /* Die Zeile zieht mit, wenn sich etwas aendert */
  G("settings.stages[0] = false; renderChips()");
  assert(sumOf('stages').startsWith('5 von 6'), 'Panels: die Zeile zieht sofort mit');
  G("settings.stages[0] = true; renderChips()");

  const wPanel = makeWindow({ 'songrate:settings': JSON.stringify({ open: { filter: true } }) });
  await waitFor(() => !wPanel.document.querySelector('#app').hidden);
  assert(wPanel.document.querySelector('details.panel[data-k="filter"]').open
    && !wPanel.document.querySelector('details.panel[data-k="play"]').open,
    'Panels: nach dem Neuladen steht wieder offen, was offen war');

  /* ---------------------------------------------------- Songliste */
  /* „Was steckt da eigentlich drin?" - mit Reinhoeren, Diensten und
     Aussortieren. Gezeichnet wird seitenweise. */
  $('.js-browse').click();
  assert(!$('#browse').hidden, 'Songliste: laesst sich oeffnen');
  const zeilen = () => [...$('#browseList').querySelectorAll('.brow')];
  assert(zeilen().length === G('BROW_PAGE'), 'Songliste: erst eine Seite (' + zeilen().length + ')');
  assert(G('browAll').length === G('activePool().length'),
    'Songliste: sie zeigt genau den Pool des Modus');
  assert(/^Songs · Charts/.test($('#browseTitle').textContent),
    'Songliste: die Ueberschrift sagt, woraus (' + $('#browseTitle').textContent + ')');

  $('#browseList').querySelector('.brow-more').click();
  assert(zeilen().length === 2 * G('BROW_PAGE'), 'Songliste: „weitere" laedt die naechste Seite nach');
  const bliste = $('#browseList');
  bliste.scrollTop = bliste.scrollHeight;
  bliste.dispatchEvent(new w.Event('scroll'));
  assert(zeilen().length === 3 * G('BROW_PAGE'), 'Songliste: unten angekommen laedt sie von selbst nach');

  /* Suchen in der Liste */
  const suchTitel = G('activePool()[0].t');
  $('#browseSearch').value = suchTitel;
  $('#browseSearch').dispatchEvent(new w.Event('input'));
  assert(G('browAll').length >= 1 && G('browAll').every(x => new RegExp(G('norm')(suchTitel), 'i').test(G('norm')(x.t + ' ' + x.a))),
    'Songliste: das Suchfeld filtert die Liste');
  $('#browseSearch').value = '';
  $('#browseSearch').dispatchEvent(new w.Event('input'));

  /* Reinhoeren */
  const erste = zeilen()[0];
  assert(erste.querySelector('.bplay') && erste.querySelector('.bact').children.length === 3,
    'Songliste: jede Zeile hat Abspielen, Dienste und Entfernen');
  erste.querySelector('.bplay').click();
  await waitFor(() => G('browPlaying') !== '', 3000);
  assert(G('browPlaying') === erste.dataset.key && erste.querySelector('.bplay').textContent === '■',
    'Songliste: Reinhoeren laeuft und der Knopf zeigt es');
  erste.querySelector('.bplay').click();
  assert(G('browPlaying') === '' && erste.querySelector('.bplay').textContent === '▶',
    'Songliste: nochmal druecken hoert auf');
  /* Kommt die Hoerprobe nicht, sagt die Zeile es - mit dem ? dran. */
  {
    const echt = G("browAll.find(s => songKey(s) === " + JSON.stringify(erste.dataset.key) + ").p");
    G("browAll.find(s => songKey(s) === " + JSON.stringify(erste.dataset.key) + ").p = 'https://audio/kaputt'");
    erste.querySelector('.bplay').click();
    await waitFor(() => $('#browseNote .why'), 3000);
    assert($('#browseNote .why') && /Reinhören fehlgeschlagen/.test($('#browseNote').textContent)
      && /audio\/kaputt/.test($('#browseNote .why').title) && G('browPlaying') === '',
      'Songliste: eine Hoerprobe, die nicht kommt, wird gemeldet und erklaert');
    G("browAll.find(s => songKey(s) === " + JSON.stringify(erste.dataset.key) + ").p = " + JSON.stringify(echt));
  }

  /* Dienste aufklappen */
  erste.querySelector('.bact button:nth-child(2)').click();
  assert(erste.querySelector('.blinks') && erste.querySelectorAll('.blinks a').length > 1,
    'Songliste: die Dienste klappen unter der Zeile auf');
  erste.querySelector('.bact button:nth-child(2)').click();
  assert(!erste.querySelector('.blinks'), 'Songliste: und wieder zu');

  /* Entfernen wirkt sofort und ueberall */
  const wegTitel = zeilen()[0].querySelector('b').textContent;
  const poolVorher = G('activePool().length');
  bliste.scrollTop = 400;
  const gezeigt = zeilen().length;
  zeilen()[0].querySelector('.bact button:last-child').click();
  assert(zeilen().length === gezeigt - 1 && bliste.scrollTop === 400,
    'Songliste: nur die eine Zeile verschwindet, die Liste springt nicht');
  assert(G('activePool().length') === poolVorher - 1, 'Songliste: Entfernen nimmt den Song aus dem Pool');
  assert(G('settings.blocked.length') === 1 && G('settings.blocked')[0].t === wegTitel,
    'Songliste: und merkt ihn sich');
  assert(G("filtered.every(s => s.t !== " + JSON.stringify(wegTitel) + " || s.a !== settings.blocked[0].a)"),
    'Songliste: auch aus der ungefilterten Auswahl');
  assert(/1 entfernt/.test($('#browseNote').textContent), 'Songliste: die Zeile sagt, wie viele weg sind');

  /* Der Reiter „Entfernt" holt sie zurueck */
  $('#browseTab [data-v="blocked"]').click();
  assert(/Entfernt \(1\)/.test($('#browseTab [data-v="blocked"]').textContent),
    'Songliste: der Reiter zaehlt mit');
  assert(zeilen().length === 1 && zeilen()[0].querySelector('b').textContent === wegTitel,
    'Songliste: der entfernte Song steht dort');
  assert(!zeilen()[0].querySelector('.bplay'), 'Songliste: ohne Datei kein Abspielknopf');
  zeilen()[0].querySelector('.bact button:last-child').click();
  assert(G('settings.blocked.length') === 0 && G('activePool().length') === poolVorher,
    'Songliste: zurueckholen bringt ihn wieder in den Pool');

  /* Der Reset-Knopf raeumt alles weg */
  $('#browseTab [data-v="pool"]').click();
  zeilen()[0].querySelector('.bact button:last-child').click();
  zeilen()[0].querySelector('.bact button:last-child').click();
  assert(G('settings.blocked.length') === 2, 'Songliste: mehrere lassen sich entfernen');
  $('#browseReset').click();
  assert(G('settings.blocked.length') === 0 && G('activePool().length') === poolVorher,
    'Songliste: „Alle zurückholen" setzt alles zurueck');

  /* Entfernt heisst ueberall entfernt, auch in der Playlist */
  const gleicher = G("({ t: activePool()[0].t, a: activePool()[0].a })");
  G("blockSong(activePool()[0])");
  assert(G(`Filters.apply(DB.songs, [], DB).some(s => s.t === ${JSON.stringify(gleicher.t)})`)
    && G(`filtered.every(s => s.t !== ${JSON.stringify(gleicher.t)} || s.a !== ${JSON.stringify(gleicher.a)})`),
    'Songliste: der Schluessel haengt an Titel und Kuenstler, nicht an der Nummer im Pool');
  G('unblockAll()');

  /* Entfernte Songs ueberleben das Neuladen */
  zeilen()[0].querySelector('.bact button:last-child').click();
  const wegStand = w.localStorage.getItem('songrate:settings');
  const wBlock = makeWindow({ 'songrate:settings': wegStand });
  await waitFor(() => !wBlock.document.querySelector('#app').hidden);
  assert(wBlock.__ev('settings.blocked.length') === 1
    && wBlock.__ev("filtered.every(s => songKey(s) !== settings.blocked[0].key)"),
    'Songliste: entfernte Songs bleiben auch nach dem Neuladen draussen');
  $('#browseReset').click();

  w.__ev('closeBrowse()');
  assert($('#browse').hidden, 'Songliste: schliesst wieder');

  /* ------------------------------------------- Fuenf zufaellige Songs */
  assert(G('usesTiers()') && G('slots().length') === 5 && G('slots()[0].id') === 'easy',
    'Ziehung: voreingestellt sind die Stufen');
  const chartsPool = G('activePool().length');
  $('#drawMode [data-v="random"]').click();
  assert(G('settings.draw') === 'random' && !G('usesTiers()'),
    'Ziehung: fuenf zufaellige lassen sich waehlen');
  assert(G('activePool().length') > chartsPool,
    'Ziehung: ohne Stufen spielen auch die Songs aus den Jahrescharts mit ('
    + chartsPool + ' → ' + G('activePool().length') + ')');
  assert(G('round')[0].tier.id === 'easy', 'Ziehung: die laufende Runde bleibt, wie sie ist');
  G('newRound()'); await tick(30);
  assert(G('round').every(r => r.tier.mult === 1) && G('round').length === 5,
    'Ziehung: die naechste Runde hat fuenf gleichwertige Plaetze');
  assert(new Set(G('round').map(r => r.song.i)).size === 5, 'Ziehung: fuenf verschiedene Songs');
  assert(/5 zufällige/.test(G("panelSum('play')[0]")), 'Ziehung: die Panelzeile sagt es');
  $('#drawMode [data-v="tiers"]').click();
  G('newRound()'); await tick(30);
  assert(G('usesTiers()') && G('round')[0].tier.id === 'easy', 'Ziehung: und wieder zurueck');

  /* ----------------------------------------------- Stufenlaengen */
  assert(G('pointsFor(0.01)') === 1000 && G('pointsFor(2)') === 500 && G('pointsFor(15)') === 150 && G('pointsFor(20)') === 100,
    'Punkte: die Stuetzpunkte stimmen');
  assert(G('pointsFor(1)') > G('pointsFor(2)') && G('pointsFor(1)') < G('pointsFor(0.5)') && G('pointsFor(5)') < 500 && G('pointsFor(5)') > 300,
    'Punkte: dazwischen wird interpoliert (' + G('pointsFor(1)') + ' bei 1 s, ' + G('pointsFor(5)') + ' bei 5 s)');
  {
    const r0 = G('round')[0];
    G('round[0].stage = 1');                           /* 0,1 s gehoert */
    const tierMult = r0.tier.mult;
    $('#ladderPreset [data-v="sanft"]').click(); await tick(20);
    assert(G('STAGES').join() === '0.5,1,2,5,10,20' && G('settings.ladder').join() === '0.5,1,2,5,10,20',
      'Laengen: die Vorlage „Sanft" gilt (' + G('STAGES').join() + ')');
    assert($('#stageChips').children.length === 6 && $('#stageChips').children[0].textContent === '0,5s'
      && G('settings.stages').every(Boolean), 'Laengen: die Chips zeigen die neue Leiter');
    assert(G('round')[0].stage === 0 && G('round')[0].status === 'playing',
      'Laengen: die Runde bleibt - 0,1 s gehoert rutscht auf die naechste Laenge, 0,5 s');
    assert(sumOf('stages') === '6 von 6 · 0,5s–20s', 'Laengen: die Panelzeile nennt die Spanne (' + sumOf('stages') + ')');
    G('choose(round[0].song); submit()'); await tick(10);
    assert(G('round')[0].points === Math.round(G('pointsFor(0.5)') * tierMult),
      'Laengen: Punkte nach gehoerter Zeit, nicht nach Stufennummer (' + G('round')[0].points + ')');
    G('closeReveal()'); await tick(10);

    /* Eigene Leiter: tippen, eine Stufe dazu, uebernehmen. */
    const inputs = () => [...$('#ladderEdit').querySelectorAll('input')];
    assert(inputs().length === 6 && inputs()[0].value === '0.5', 'Laengen: der Editor zeigt die aktuelle Leiter');
    $('#ladderAdd').click();
    assert(inputs().length === 7, 'Laengen: + Stufe haengt eine an');
    inputs()[6].value = '40'; inputs()[6].dispatchEvent(new w.Event('input'));   /* zu lang, faellt raus */
    inputs()[0].value = '0.25'; inputs()[0].dispatchEvent(new w.Event('input'));
    inputs()[1].value = '0.25'; inputs()[1].dispatchEvent(new w.Event('input'));  /* doppelt, faellt zusammen */
    $('#ladderGo').click(); await tick(10);
    assert(G('STAGES').join() === '0.25,2,5,10,20', 'Laengen: eigene Leiter sortiert, ohne Doppel, ohne 40 s (' + G('STAGES').join() + ')');
    assert(/Übernommen/.test($('#ladderNote').textContent), 'Laengen: die Notiz bestaetigt es');
    inputs().forEach(i => { i.value = '1'; i.dispatchEvent(new w.Event('input')); });
    $('#ladderGo').click(); await tick(10);
    assert(G('STAGES').join() === '0.25,2,5,10,20' && /Mindestens/.test($('#ladderNote').textContent),
      'Laengen: nur eine Laenge wird abgelehnt');
    $('#ladderPreset [data-v="standard"]').click(); await tick(20);
    assert(G('STAGES').join() === '0.01,0.1,0.5,2,8,15' && G('settings.stages').length === 6, 'Laengen: und zurueck auf Standard');
    assert(JSON.parse(w.localStorage.getItem('songrate:settings')).ladder.join() === '0.01,0.1,0.5,2,8,15',
      'Laengen: die Leiter wird gespeichert');
  }

  /* ----------------------------------------------- Schwierigkeit */
  {
    const t$ = sel => $('#tierPanel ' + sel);
    const inputs = () => [...t$('#tierRows').querySelectorAll('input')];
    assert(t$('#tierPreset [data-v="normal"]').classList.contains('on') && G('tierCuts()').join() === '15,35,55,75,100',
      'Schwierigkeit: voreingestellt ist Normal');
    assert(sumOf('tiers') === 'Normal · Hits 20 %', 'Schwierigkeit: die Panelzeile (' + sumOf('tiers') + ')');
    const nCharts = G('chartFiltered.length');
    assert(inputs().length === 5 && inputs()[0].value === '15'
      && new RegExp('^' + Math.round(nCharts * 0.15) + ' Songs · ab \\d').test(t$('.trow .tinfo').textContent),
      'Schwierigkeit: je Stufe Prozent, Songzahl und Streamgrenze (' + t$('.trow .tinfo').textContent + ')');
    assert(t$('#tierBar').children.length === 5 && t$('#tierBar').children[0].style.width === '15%',
      'Schwierigkeit: der Balken zeigt die Baender');

    t$('#tierPreset [data-v="leicht"]').click(); await tick(10);
    assert(G('tierCuts()').join() === '5,12,22,35,50' && G('byTier.easy.length') === Math.round(nCharts * 0.05),
      'Schwierigkeit: Leicht nimmt nur die obersten 5 % als Easy');
    assert(G('tierInfo.played') === Math.round(nCharts * 0.5) && /davon in den Stufen/.test($('#filterCount').textContent),
      'Schwierigkeit: die untere Haelfte bleibt draussen, die Songauswahl sagt es');
    assert(monotone(G), 'Schwierigkeit: Reihenfolge bleibt nach Streams');
    assert(G('round')[0].tier.id === 'easy' && G('round').length === 5, 'Schwierigkeit: die laufende Runde bleibt');

    /* Eine Grenze von Hand: Easy = Top 1 %. */
    inputs()[0].value = '1'; inputs()[0].dispatchEvent(new w.Event('change')); await tick(10);
    assert(G('tierCuts()').join() === '1,12,22,35,50' && sumOf('tiers').startsWith('Eigene'),
      'Schwierigkeit: eine eigene Grenze macht daraus „Eigene" (' + G('tierCuts()').join() + ')');
    assert(G('byTier.easy.length') === Math.round(nCharts * 0.01) && G('byTier.easy.every(s => s.s >= 2.5e9)'),
      'Schwierigkeit: Easy = Top 1 % sind die ganz grossen (' + G('byTier.easy.length') + ' Songs)');
    inputs()[2].value = '5'; inputs()[2].dispatchEvent(new w.Event('change')); await tick(10);
    assert(G('tierCuts()').join() === '1,12,13,35,50', 'Schwierigkeit: eine Grenze unter der vorigen wird hochgezogen');

    /* Eigene Grenzen nur fuer ein Jahrzehnt. */
    G("setMode('decades')"); await tick(30);
    const decNow = G('(currentPick()||{}).value');
    assert(!t$('#tierOwn').closest('.switch').hidden && /Eigene Grenzen für \d+er/.test(t$('#tierOwnTxt').textContent),
      'Schwierigkeit: der Schalter nennt das Jahrzehnt (' + t$('#tierOwnTxt').textContent + ')');
    t$('#tierOwn').checked = true; t$('#tierOwn').dispatchEvent(new w.Event('change')); await tick(10);
    assert(G('settings.tiers.scopes')['dec-' + decNow] && sumOf('tiers').includes('hier eigene'),
      'Schwierigkeit: eigene Grenzen fuer das Jahrzehnt angelegt');
    t$('#tierPreset [data-v="schwer"]').click(); await tick(10);
    assert(G('tierCuts()').join() === '25,45,65,85,100' && G('settings.tiers.global').join() === '1,12,13,35,50',
      'Schwierigkeit: die Vorlage trifft nur das Jahrzehnt, global bleibt');
    $('#pickNext').click(); await tick(40);
    assert(G('tierCuts()').join() === '1,12,13,35,50', 'Schwierigkeit: das naechste Jahrzehnt nimmt wieder die globalen');
    $('#pickPrev').click(); await tick(40);
    t$('#tierOwn').checked = false; t$('#tierOwn').dispatchEvent(new w.Event('change')); await tick(10);
    assert(!G('settings.tiers.scopes')['dec-' + decNow] && G('tierCuts()').join() === '1,12,13,35,50',
      'Schwierigkeit: Schalter aus nimmt die eigenen Grenzen weg');
    G("setMode('playlist')");
    assert(t$('#tierOwn').closest('.switch').hidden || G('mode') !== 'playlist', 'Schwierigkeit: ohne Playlist kein Wechsel');
    G("setMode('charts')"); await tick(30);
    t$('#tierPreset [data-v="normal"]').click(); await tick(10);
    assert(G('tierCuts()').join() === '15,35,55,75,100', 'Schwierigkeit: zurueck auf Normal');

    /* Nur Hits: Anteil einstellbar. */
    t$('#hitShare').value = '5'; t$('#hitShare').dispatchEvent(new w.Event('change')); await tick(10);
    assert(G('settings.hitShare') === 5 && sumOf('tiers') === 'Normal · Hits 5 %', 'Schwierigkeit: der Hit-Anteil laesst sich setzen');
  }

  /* ------------------------------------------------------- Nur Hits */
  const hitSwitch = on => { $('#hitMode').checked = on; $('#hitMode').dispatchEvent(new w.Event('change')); };
  G('settings.hitShare = 20');
  hitSwitch(true);
  assert(G('settings.hits') && !G('usesTiers()'), 'Nur Hits: ohne Stufen');
  const gestreamt = G('filtered.filter(s => s.s > 0).length');
  assert(G('activePool().length') === Math.ceil(gestreamt * 0.2),
    `Nur Hits: in den Charts das oberste Fuenftel (${G('activePool().length')} von ${gestreamt})`);
  const kleinsterHit = G('Math.min(...activePool().map(s => s.s))');
  assert(G(`filtered.filter(s => s.s > ${kleinsterHit}).every(s => activePool().includes(s))`)
    && G('activePool().every(s => s.s > 0)'), 'Nur Hits: und zwar die mit den meisten Streams');
  assert(G('round')[0].tier.id === 'easy', 'Nur Hits: die laufende Runde bleibt, wie sie ist');
  $('#rerollAll').click(); await tick(30);
  assert(G('round').every(r => r.tier.hit) && G('round')[0].tier.label === 'Hit 1'
    && $('#tierList').textContent.includes('Hit 5'), 'Nur Hits: die Plaetze heissen Hit 1 bis 5');
  assert(G('round.every(r => activePool().includes(r.song))'), 'Nur Hits: gezogen wird nur aus den Hits');
  assert(/Nur Hits/.test(G("panelSum('play')[0]")) && /Nur Hits/.test(G("panelSum('filter')[0]")),
    'Nur Hits: die Panelzeilen sagen es');
  assert(/davon die \d+ bekanntesten/.test($('#filterCount').textContent),
    'Nur Hits: die Songauswahl nennt die Zahl (' + $('#filterCount').textContent + ')');
  G("setMode('decades')"); await tick(30);
  assert(G('activePool().length') === Math.max(10, Math.ceil(G('pickFiltered.length') * 0.2)),
    'Nur Hits: im Jahrzehnt das oberste Fuenftel');
  assert(/Hits aus \d+/.test($('#pickCount').textContent), 'Nur Hits: die Leiste oben sagt es (' + $('#pickCount').textContent + ')');
  const hitsVor = (G('stats.byTier.hits') || { p: 0 }).p;
  G('choose(round[active].song); submit()'); await tick(10); G('closeReveal()'); await tick(10);
  assert(G('stats.byTier.hits').p === hitsVor + 1 && $('#stats').textContent.includes('Nur Hits'),
    'Nur Hits: eigene Zeile in der Statistik');
  G("setMode('charts')"); await tick(30);
  hitSwitch(false);
  G('newRound()'); await tick(30);
  assert(G('usesTiers()') && G('round')[0].tier.id === 'easy', 'Nur Hits: und wieder aus');

  /* ---------------------------------------------------- Playlist-Modus */
  const csv = 'Track Name,Artist Name(s)\nUnstoppable,Sia\nBlinding Lights,The Weeknd\nLevitating,Dua Lipa\n'
            + 'Hello,Adele\nBad Guy,Billie Eilish\nStronger,Britney Spears\nGibtsNicht,Niemand';
  await G(`loadPlaylistText(${JSON.stringify(csv)}, 'Testliste')`);
  await waitFor(() => G('plBusy') === false, 20000);

  assert(G('PL') != null && G('PL.songs.length') === 6, 'Playlist: sechs von sieben aufgeloest');
  assert(G('plJob.missed.size') === 1, 'Playlist: der unbekannte Titel wird gemeldet');
  assert(G("[...plJob.found.values()].filter(f => f.via === 'local').length") === 6,
    'Playlist: bekannte Hits kommen ohne Anfrage aus songs.json');
  assert(G('mode') === 'playlist', 'Playlist: Modus schaltet um');
  assert($('#tabs').children.length === 5, 'Playlist: fuenf Reiter');
  assert(new Set(G('round').map(r => r.song.t)).size === 5, 'Playlist: fuenf verschiedene Songs');
  assert(G('round').every(r => r.tier.mult === 1), 'Playlist: keine Stufenfaktoren');

  G("settings.suggest = 'pool'; suggest('bl')");
  assert(G('sugItems').length > 0 && G('sugItems').every(s => G('PL.songs').some(x => x.t === s.t)),
    'Playlist: mit „nur Auswahl" kommen die Vorschlaege nur aus der Playlist');
  G("settings.suggest = 'all'; suggest('bl')");
  assert(G('sugAll').length > G('PL.songs').filter(s => /^bl/i.test(s.t)).length,
    'Playlist: mit „alle" kommen auch die Songs der Songliste dazu');
  assert(G("PL.songs.find(s => s.t.startsWith('Levitating')).ar").length >= 2
    && G('PL.artists').includes('DaBaby'),
    'Playlist: Kollaboration bekommt mehrere Kuenstler-IDs, auch die aus songs.json');

  for (let i = 0; i < 5; i++) { G('choose(round[active].song); submit()'); await tick(10); G('closeReveal()'); await tick(10); }
  assert(!$('#summary').hidden, 'Playlist: Rundenende zeigt das Ergebnis');
  assert(/\d+ von \d+ erraten/.test($('#summaryHits').textContent),
    'Rundenende: es steht da, wie viele erraten wurden (' + $('#summaryHits').textContent + ')');
  assert(G('stats.byTier.playlist') != null && G('stats.byTier.pl1') == null, 'Playlist: Statistik unter einem Schluessel');
  const ergZeilen = [...$('#summaryList').querySelectorAll('.s-link')];
  assert(ergZeilen.length === 5 && ergZeilen.every(a => /^https:\/\/music\.apple\.com/.test(a.href)),
    'Rundenende: jede Zeile verlinkt zum Lieblingsdienst');
  assert(G("PL.songs.every(s => s.k)"), 'Playlist: Apples Track-ID wird mitgenommen');
  $('#summaryNext').click(); await tick(30);

  const calls = itunesCalls;
  await G(`loadPlaylistText(${JSON.stringify(csv)}, 'Testliste')`);
  await waitFor(() => G('plBusy') === false, 20000);
  assert(itunesCalls === calls, 'Playlist: zweiter Import kostet keine Anfrage ('
    + (itunesCalls - calls) + ')');

  /* Nur Hits in der Playlist: was songs.json kennt, nach Streams vorn. */
  G('settings.hits = true');
  assert(G('activePool()[0].t') === 'Blinding Lights' && G('activePool().length') === 6,
    'Nur Hits: in der Playlist kommen die bekanntesten nach vorn');
  G('settings.hits = false');

  /* ------------------------------- Ein Spotify-Export, wie er wirklich ist */
  searchTerms = [];
  isrcCalls = [];
  const exportify = 'Track URI,ISRC,Track Name,Album Name,Artist Name(s)\n'
    + 'spotify:track:1,DEMOC8300001,"Testlied - 2005 Remaster","Mockalbum","Mockband;Gast Eins;Gast Zwei"\n'
    + 'spotify:track:2,,"Gänsehaut’s Lied","Gans","JAŸ-Band"\n'
    + 'spotify:track:3,,"Eins","Stapel","Stapelband"\n'
    + 'spotify:track:4,,"Zwei","Stapel","Stapelband"\n'
    + 'spotify:track:5,,"Drei","Stapel","Stapelband;Gast"\n'
    + 'spotify:track:6,,"Unstoppable","This Is Acting","Sia"\n'
    + 'spotify:track:7,DEMOC9900099,"Gibts nicht","Nirgends","Niemand"\n'
    + 'spotify:track:8,DEMOC1200003,"Dieses Lied","X","Ganz Anders"\n'
    + 'spotify:track:9,,"Vier","Stapel","Stapelband"\n'
    + 'https://open.spotify.com/track/expl1,,"Explizites Lied","Vol.1","Mockband"\n'
    + 'spotify:track:11,,"Kaputt Lied","Nirgends","Kaputtband"\n';
  assert(G(`Playlist.parse(${JSON.stringify(exportify)}).tracks[0].isrc`) === 'DEMOC8300001'
    && G(`Playlist.parse(${JSON.stringify(exportify)}).tracks[1].isrc`) == null,
    'Export: die ISRC-Spalte wird gelesen, leere Zellen bleiben leer');
  odesliCalls = [];
  const albumCalls = () => searchTerms.filter(x => /^album:/.test(x)).length;
  await G(`loadPlaylistText(${JSON.stringify(exportify)}, 'Export')`);
  await waitFor(() => G('plBusy') === false, 20000);
  const via = k => G(`(() => { const t = plJob.tracks.find(x => x.title.startsWith(${JSON.stringify(k)}));
    const f = t && plJob.found.get(t.key); return f ? f.via + ':' + f.song.t : 'fehlt'; })()`);
  assert(via('Testlied') === 'isrc:Testlied',
    'Export: mit ISRC kommt der Titel ueber den Nachschlag, nicht ueber die Suche (' + via('Testlied') + ')');
  assert(via('Dieses Lied') === 'isrc:Dieses Lied (Original Mix)',
    'Export: die ISRC findet auch, was bei Apple anders heisst (' + via('Dieses Lied') + ')');
  assert(isrcCalls.length >= 1 && isrcCalls[0] === 3 && !searchTerms.some(x => /Testlied|Dieses Lied/.test(x)),
    'Export: ein Nachschlag fuer alle drei Codes, keine Suche nach ihnen (' + isrcCalls.join('/') + ')');
  assert(via('Gibts') === 'fehlt' && searchTerms.some(x => /Gibts nicht/.test(x)),
    'Export: ein unbekannter Code faellt auf die Suche zurueck');
  assert(via('Vier') === 'artist:Vier' && !searchTerms.some(x => /^Vier/.test(x)),
    'Export: was die Suche verschweigt, holt der Lookup ueber die Kuenstler-ID (' + via('Vier') + ')');
  assert(/^search:Gänsehaut/.test(via('Gänsehaut')),
    'Export: JAŸ und typografischer Apostroph werden geglaettet (' + via('Gänsehaut') + ')');
  assert(['Eins', 'Zwei', 'Drei'].every(t => via(t) === 'artist:' + t),
    'Export: drei Titel eines Kuenstlers kommen aus seinem Katalog');
  assert(searchTerms.filter(x => x === 'katalog:stapelband').length === 1
    && !searchTerms.some(x => /^(Eins|Zwei|Drei)\b/.test(x)), 'Export: dafuer genuegt eine Anfrage');
  assert(via('Unstoppable') === 'local:Unstoppable', 'Export: was in songs.json steht, kostet nichts');
  assert(G('plJob.missed.size') === 2 && via('Gibts') === 'fehlt', 'Export: der unbekannte Titel bleibt als fehlend stehen');
  /* Warum etwas fehlt: Apple hatte nichts - oder die Anfrage kam nie an. */
  const whyVon = k => G(`plJob.tracks.find(x => x.title.startsWith(${JSON.stringify(k)})).why`);
  assert(whyVon('Gibts').kind === 'none' && whyVon('Gibts').log.some(l => /ISRC DEMOC9900099/.test(l))
    && whyVon('Gibts').log.some(l => /^Suche „Gibts nicht Niemand“ \(DE\)/.test(l))
    && whyVon('Gibts').log.some(l => /^Album „Nirgends“ \(US\)/.test(l)),
    'Export: der Grund fuehrt Protokoll - ISRC, Suche, Album (' + whyVon('Gibts').log.join(' | ') + ')');
  assert(whyVon('Kaputt').kind === 'error' && whyVon('Kaputt').error.net
    && whyVon('Kaputt').log.filter(l => /neuer Versuch/.test(l)).length === 2
    && searchTerms.filter(x => /^Kaputt Lied Kaputtband$/.test(x)).length === 3,
    'Export: ein Netzfehler wird zweimal wiederholt, dann steht er als Grund da (' + whyVon('Kaputt').log.join(' | ') + ')');
  assert(via('Explizites') === 'album:Explizites Lied',
    'Export: was Apples Suche verschweigt, kommt ueber das Album (' + via('Explizites') + ')');
  /* „Explizites Lied": Album in DE gefunden, eine Suche. „Gibts nicht":
     nichts, DE und US, zwei Suchen. Sonst fragt niemand nach Alben. */
  assert(albumCalls() === 3 && searchTerms.some(x => x === 'album:Vol.1 Mockband'),
    'Export: das Album wird nur fuer die zwei gesucht, die sonst nirgends zu finden waren (' + albumCalls() + ')');
  assert(!odesliCalls.length, 'Export: song.link wird nicht gefragt - die API ist dicht');
  assert(G("PL.songs.find(s => s.t === 'Explizites Lied').k") === 9001,
    'Export: der Umweg bringt Apples Track-ID mit');

  assert(!searchTerms.some(x => /Remaster|Eins Gast|;/.test(x)),
    'Export: kein Suchbegriff traegt Zusatz oder Semikolon (' + searchTerms.join(' | ') + ')');
  assert($('#plView').textContent.includes('2 fehlen'), 'Export: die Playlist-Zeile nennt, was fehlt');

  /* ------------------------ Titelliste: sehen, was fehlt, selbst nachhelfen */
  $('#plView').click(); await tick(10);
  assert(!$('#imp').hidden && G('impTab') === 'missed', 'Titelliste: oeffnet bei dem, was fehlt');
  assert($('#impTab [data-v="found"]').textContent === 'Gefunden (9)',
    'Titelliste: die Reiter zaehlen mit (' + $('#impTab [data-v="found"]').textContent + ')');
  const missRow = $('#impList .brow');
  {
    const zeilen = [...$('#impList').querySelectorAll('.brow')];
    const kaputt = zeilen.find(r => r.textContent.includes('Kaputt Lied'));
    assert(missRow.textContent.includes('Gibts nicht') && /bei Apple nicht gefunden/.test(missRow.textContent)
      && /ISRC DEMOC9900099/.test(missRow.querySelector('.why').title) && /Versucht:/.test(missRow.querySelector('.why').title),
      'Titelliste: die Zeile sagt, warum der Titel fehlt, das ? zeigt das Protokoll');
    assert(kaputt && /Verbindungsproblem/.test(kaputt.textContent) && /nicht angekommen/.test(kaputt.querySelector('.why').title)
      && /↻ sucht noch einmal/.test(kaputt.querySelector('.why').title),
      'Titelliste: ein Verbindungsproblem heisst nicht „gibt es nicht“');
    kaputt.querySelector('.why').click();
    assert(kaputt.querySelector(':scope > .whybox'), 'Titelliste: das Protokoll klappt in der Zeile auf');
    kaputt.querySelector('.why').click();
    const q = JSON.parse(w.localStorage.getItem('songrate:plqueue'));
    assert(q.whys && Object.values(q.whys).some(x => x.kind === 'error') && Object.values(q.whys).some(x => x.kind === 'none'),
      'Titelliste: die Gruende werden mitgespeichert');
  }
  assert(missRow && missRow.textContent.includes('Gibts nicht'), 'Titelliste: der fehlende Titel steht da');
  missRow.querySelector('button[title="Selbst suchen"]').click(); await tick(20);
  const finder = $('#impList .imp-find input');
  assert(finder && finder.value === 'Gibts nicht Niemand',
    'Titelliste: die Suche ist mit Titel und Kuenstler vorbelegt (' + (finder && finder.value) + ')');
  finder.value = 'neuer song';
  finder.dispatchEvent(new w.Event('input'));
  await waitFor(() => $('#impList .imp-hit .arhit'), 3000);
  G('renderImport()');
  assert($('#impList .imp-find input') === finder, 'Titelliste: Nachzeichnen laesst die offene Suche stehen');
  $('#impList .imp-hit .arhit').click(); await tick(300);
  assert(via('Gibts') === 'manual:Neuer Song', 'Titelliste: ein Klick ordnet den Treffer zu');
  assert(G('PL.songs').some(s => s.t === 'Neuer Song'), 'Titelliste: und er spielt in der Playlist mit');
  assert(JSON.parse(w.localStorage.getItem('songrate:plcache'))[G("plJob.tracks.find(t => t.title === 'Gibts nicht').key")].t === 'Neuer Song',
    'Titelliste: die Zuordnung ueberlebt das Neuladen');
  assert(G('plJob.missed.size') === 1 && !$('#impList').textContent.includes('Gibts nicht'),
    'Titelliste: der zugeordnete Titel steht nicht mehr unter „Fehlt“');

  /* Handsuche ueber Alben: Album antippen, Titel waehlen. */
  {
    $('#impTab [data-v="found"]').click(); await tick(10);
    const zeile = [...$('#impList').querySelectorAll('.brow')].find(r => r.textContent.includes('Gibts nicht'));
    zeile.querySelector('button[title="Anderen Song zuordnen"]').click(); await tick(20);
    const fin = $('#impList .imp-find');
    fin.querySelector('.imp-kind [data-v="album"]').click();
    fin.querySelector('input').value = 'Loud Rihanna';
    fin.querySelector('input').dispatchEvent(new w.Event('input'));
    await waitFor(() => fin.querySelector('.fopts .arhit'), 3000);
    const alb = [...fin.querySelectorAll('.fopts .arhit')].find(b => b.textContent.includes('Loud'));
    assert(alb && /3 Titel/.test(alb.textContent), 'Handsuche: Alben lassen sich suchen (' + (alb && alb.textContent) + ')');
    alb.click();
    await waitFor(() => fin.querySelector('.imp-hit .arhit'), 3000);
    assert([...fin.querySelectorAll('.imp-hit .arhit')].length === 2, 'Handsuche: das Album klappt seine Titel auf');
    fin.querySelector('.imp-hit .arhit').click(); await tick(300);
    assert(via('Gibts') === 'manual:Loudsong 1', 'Handsuche: ein Albumtitel laesst sich zuordnen (' + via('Gibts') + ')');
    G("impKind = 'song'");
  }

  $('#impTab [data-v="found"]').click(); await tick(10);
  const testRow = [...$('#impList').querySelectorAll('.brow')].find(r => r.textContent.includes('Testlied'));
  assert(testRow && testRow.textContent.includes('über die ISRC') && testRow.textContent.includes('In der Liste: Testlied - 2005 Remaster') === false,
    'Titelliste: sagt, woher der Treffer kam');
  testRow.querySelector('button[title^="Falscher Treffer"]').click(); await tick(300);
  assert(via('Testlied') === 'fehlt' && !G('PL.songs').some(s => s.t === 'Testlied'),
    'Titelliste: ein falscher Treffer laesst sich herausnehmen');
  $('#impTab [data-v="missed"]').click(); await tick(10);
  $('#impList .brow button[title="Nochmal automatisch suchen"]').click();
  await waitFor(() => G('plBusy') === false && via('Testlied') !== 'fehlt', 5000);
  assert(via('Testlied') === 'search:Testlied', 'Titelliste: „nochmal" sucht wieder automatisch');
  $('#impDone').click();
  assert($('#imp').hidden, 'Titelliste: schliesst wieder');

  /* Von Hand zugeordnet, waehrend genau dieser Titel noch gesucht wird: die
     Hand gewinnt, das spaete Suchergebnis wird verworfen. */
  {
    const echt = w.fetch;
    let freigeben;
    w.fetch = (url, o) => (String(url).includes('term=Testlied')
      ? new Promise(r => { freigeben = () => r(echt(url, o)); }) : echt(url, o));
    G("Playlist.assign(plJob, plJob.tracks.find(t => t.title.startsWith('Testlied')).key, null)");
    G("Playlist.retry(plJob, plJob.tracks.find(t => t.title.startsWith('Testlied')).key); runResolve(plJob)");
    await waitFor(() => freigeben, 3000);
    G("Playlist.assign(plJob, plJob.tracks.find(t => t.title.startsWith('Testlied')).key, { t: 'Handwahl', a: 'Mockband', p: 'https://audio/h', k: 77 })");
    freigeben();
    await waitFor(() => G('plBusy') === false, 5000);
    w.fetch = echt;
    assert(via('Testlied') === 'manual:Handwahl', 'Titelliste: die Handwahl schlaegt die laufende Suche (' + via('Testlied') + ')');
  }

  /* Nimmt Apple keine Liste, geht es nach dem ersten leeren Versuch einzeln. */
  isrcBatchBroken = true; isrcCalls = [];
  const einzelListe = 'ISRC,Track Name,Artist Name(s)\nDEMOC0900002,"Noch ein Lied","Egal"\nDEMOC8800088,"Unbekannt","Egal"\n';
  G("Playlist.assign(plJob, 'x', null)");
  await G(`loadPlaylistText(${JSON.stringify(einzelListe)}, 'Einzeln')`);
  await waitFor(() => G('plBusy') === false, 20000);
  assert(isrcCalls[0] === 2 && isrcCalls.slice(1).every(n => n === 1) && isrcCalls.length === 3,
    'ISRC: eine leere Sammelantwort, danach einzeln (' + isrcCalls.join('/') + ')');
  assert(via('Noch ein Lied') === "isrc:Gänsehaut's Lied" && !G('Playlist.pace().isrcBatch'),
    'ISRC: der einzelne Treffer beweist es, Listen bleiben aus (' + via('Noch ein Lied') + ')');
  isrcBatchBroken = false;

  /* Vorschlaege: alles Bekannte oder nur die Auswahl. */
  G("suggest('loudsong')");
  assert(G('sugAll').length >= 1, 'Vorschlaege: in der Playlist stehen auch Songs aus der Songliste bereit');
  G("suggest('unstoppable')");
  assert(G('sugAll').some(s => s.t === 'Unstoppable'), 'Vorschlaege: „alle" findet den Hit auch im Playlist-Modus');
  $('#sugMode [data-v="pool"]').click();
  G("suggest('blinding')");
  assert(G('settings.suggest') === 'pool' && G('sugAll').every(s => G('activePool()').includes(s)),
    'Vorschlaege: „nur Auswahl" bleibt im Pool');
  assert(/Vorschläge nur Auswahl/.test(G("panelSum('play')[0]")), 'Vorschlaege: die Panelzeile sagt es');
  $('#sugMode [data-v="all"]').click();
  /* Ein Vorschlag aus einer anderen Quelle zaehlt - ueber Titel und Kuenstler, nicht ueber die Nummer. */
  /* Der Song im Platz stammt aus einer anderen Quelle (andere Nummer), der
     Vorschlag aus der Songliste. */
  G("round[active].song = { ...DB.songs.find(s => s.t === 'Blinding Lights'), i: 99999 }; round[active].status = 'playing'; round[active].guesses = []");
  G("pick = DB.songs.find(s => s.t === 'Blinding Lights'); submit()"); await tick(10);
  assert(G('round[active].status') === 'won', 'Raten: derselbe Song aus einer anderen Quelle gilt als Treffer');
  G('closeReveal()'); await tick(10);
  G("round[active].song = { ...DB.songs.find(s => s.t === 'Hello' && s.a === 'Adele'), i: 99998 }; round[active].status = 'playing'; round[active].guesses = []");
  G("pick = { t: 'Someone Like You', a: 'Adele', anl: ['adele'] }; submit()"); await tick(10);
  assert(G('round[active].guesses').some(g => g.kind === 'artist'), 'Raten: gleicher Kuenstler aus fremder Quelle wird gelb');
  G("round.forEach(r => { r.status = 'playing'; r.guesses = []; r.stage = 0; })");

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

  /* Die Stufen werden innerhalb des Jahrzehnts verteilt, nach den
     Prozentgrenzen der Schwierigkeit (Normal: 15/35/55/75/100). */
  const sizes = G('TIERS.map(t => byTier[t.id].length)');
  const nDec = G('pickFiltered').length;
  assert(sizes.reduce((a, b) => a + b, 0) === nDec, 'Jahrzehnte: jeder Song landet in genau einer Stufe');
  assert(Math.abs(sizes[0] - nDec * 0.15) <= 1 && Math.abs(sizes[1] - nDec * 0.2) <= 1,
    'Jahrzehnte: Easy ist das oberste Siebtel, Medium das naechste Fuenftel (' + sizes.join('/') + ' von ' + nDec + ')');
  assert(monotone(G), 'Jahrzehnte: keine Stufe ist bekannter als die davor');

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

  /* Nachhoeren: eine Zeile mit allen Diensten.
     Ohne Track-ID, damit der Sammellink hier nicht mitzaehlt - seit dem
     Chartsneubau haben die meisten Songs eine, und der Test soll die Regel
     pruefen, nicht den Datenstand. */
  G('delete round[0].song.k; showReveal(round[0], false)');
  assert($('#revealLinks').querySelectorAll('a').length === 1
    && $('#revealLinks').querySelector('a').textContent === 'Apple Music',
    'Aufloesung: erst einmal steht nur der eigene Dienst da');
  assert(/\+ \d+ weitere/.test($('#revealLinks').querySelector('.more').textContent),
    'Aufloesung: die anderen kommen auf Klick');
  $('#revealLinks').querySelector('.more').click();
  const svc = [...$('#revealLinks').querySelectorAll('a')];
  assert(svc.length === G('Links.SERVICES.length'),
    'Aufloesung: dann stehen alle da (' + svc.length + ')');
  assert(G('settings.svcAll') === true, 'Aufloesung: das bleibt so, bis man es zurueckstellt');
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
  assert(svc.some(a => /play\.qobuz\.com/.test(a.href)) && svc.some(a => a.classList.contains('shop')),
    'Aufloesung: Qobuz zeigt auf den Player, der Kaufladen steht getrennt');
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
  G('closeReveal()'); await tick(20);
  [...$('#svcSeg').querySelectorAll('button')].find(b => b.textContent === 'Apple Music').click();
  G('newRound()'); await tick(30);

  /* --------------------------------------------- Genaue Links aus dem Cache */
  /* song.links API ist dicht (401). Was frueher beantwortet wurde, liegt noch
     im Speicher und wird genutzt - gefragt wird nie mehr. Eigenes Fenster
     mit vorbelegtem Cache. */
  const wEx = makeWindow({ 'songrate:links': JSON.stringify({ 1440857781: {
    spotify: 'https://open.spotify.com/track/abc1440857781', tidal: 'https://tidal.com/browse/track/1440857781',
    songlink: 'https://song.link/i/1440857781' } }) });
  const X = n => wEx.__ev(n), x$ = q => wEx.document.querySelector(q);
  await waitFor(() => !wEx.document.querySelector('#app').hidden);
  const exLinks = () => [...x$('#revealLinks').querySelectorAll('a')];
  const bei = n => exLinks().find(a => a.textContent === n);

  odesliCalls = [];
  X('settings.svcAll = true; round[0].song.k = 1440857781; showReveal(round[0], false)');
  await tick(60);
  assert(/open\.spotify\.com\/track\/abc1440857781/.test(bei('Spotify').href)
    && bei('Spotify').classList.contains('exact') && /tidal\.com\/browse\/track\//.test(bei('Tidal').href),
    'Genau: gemerkte Adressen zeigen weiter auf den Song selbst');
  assert(/play\.qobuz\.com\/search/.test(bei('Qobuz').href) && !bei('Qobuz').classList.contains('exact'),
    'Genau: ohne gemerkte Adresse bleibt die Suche');
  assert(/open\.spotify\.com\/track\//.test(X("Links.one(round[0].song, 'spotify')")),
    'Genau: auch die Ergebnisliste nimmt die gemerkte Adresse');
  X('closeReveal()'); await tick(20);
  X('round[0].song.k = 666; showReveal(round[0], false)'); await tick(80);
  assert(!odesliCalls.length && exLinks().some(a => /music\.apple\.com\/de\/search/.test(a.href))
    && !x$('#revealLinks').querySelector('.exact'),
    'Genau: song.link wird nicht mehr gefragt, es bleibt die Suche');
  assert(!x$('#svcExact') && X('settings.exact') === undefined, 'Genau: der Schalter ist weg');
  X('closeReveal()'); await tick(20);

  /* Filter gelten hier genauso */
  const n0 = G('pickFiltered').length;
  G(`settings.filters.push({ mode: 'ohne', type: 'genre', value: 'pop', text: 'Pop' }); applyFilters()`);
  assert(G('pickFiltered').length < n0 && G('pickFiltered').every(s => s.g !== 'Pop'),
    'Jahrzehnte: die Filter der Charts wirken auch hier');
  G(`settings.filters = settings.filters.filter(r => r.type !== 'genre'); applyFilters()`);

  /* Zurueck in den Chartsmodus gelten wieder die festen Stufen */
  $('#modeSeg [data-v="charts"]').click(); await tick(40);
  assert(G('mode') === 'charts' && $('#pickBar').hidden, 'Jahrzehnte: zurueck zu den Charts');
  assert(G("byTier.easy.every(s => s.s > 0)") && monotone(G) && G("byTier.easy.length") === Math.round(G('chartFiltered.length') * 0.15),
    'Jahrzehnte: die Charts haben wieder ihre Stufen - nach Streams, Easy das oberste 15 %');

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
  assert(H("TIERS.every(t => byTier[t.id].every(s => s.s > 0))") && monotone(H),
    'Jahrescharts: die Chartstufen bleiben rein nach Streams');
  /* Die Schaetzung: Platz 1 eines Jahres liegt ueber Platz 40, und beide
     irgendwo zwischen den gestreamten Songs des Jahrzehnts. */
  const est = i => H(`DB.songs.find(s => s.t === 'Achtziger ${i}').pop`);
  const ref80 = H("(() => { const a = DB.songs.filter(s => s.s > 0 && s.y >= 1980 && s.y < 1990).map(s => s.s).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; })()");
  assert(est(1) > est(20) && est(20) > est(40) && est(1) > ref80 && est(40) < ref80,
    `Jahrescharts: Bekanntheit wird aus dem Platz geschaetzt (${Math.round(est(1) / 1e6)} > ${Math.round(est(20) / 1e6)} > ${Math.round(est(40) / 1e6)} Mio., Median ${Math.round(ref80 / 1e6)})`);
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
  assert(K('AR.songs').length === 11,
    'Kuenstler: Katalog, Gastauftritt und Lookup zusammen, ohne Dubletten (' + K('AR.songs').length + ')');
  assert(K("AR.songs.some(s => /Gastsong/.test(s.t))"), 'Kuenstler: der Gastauftritt ist dabei');
  assert(K("AR.songs.some(s => s.t === 'Verschwiegener Song')") && K("AR.songs.filter(s => s.t === 'Katalogsong 1').length") === 1,
    'Kuenstler: der Lookup ueber die ID bringt mit, was die Suche verschweigt - ohne Doppel');
  assert(K("AR.songs.every(s => !/\\(Live\\)/.test(s.t))"), 'Kuenstler: Livefassungen fliegen raus');
  assert(K("AR.songs.every(s => s.t !== 'Testband & Wer Anders')"),
    'Kuenstler: ein fremder Song, der ihn nur im Titel nennt, bleibt draussen');
  assert(K("AR.songs.some(s => s.t === 'Katalogsong 2')")
    && K("AR.songs.every(s => !/Extended Club/.test(s.t))"),
    'Kuenstler: gibt es den Song auch schlicht, faellt die Clubfassung weg');
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

  /* Nur Hits: songs.json kennt die Testband nicht, also Apples Reihenfolge. */
  K('settings.hits = true');
  assert(K('activePool().length') === Math.min(10, K('pickFiltered.length'))
    && K('activePool()[0].t') === K('pickFiltered[0].t'),
    'Nur Hits: beim Kuenstler ohne Streamzahlen in Apples Reihenfolge');
  K('settings.hits = false');

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

  /* Ein Katalog aus einer aelteren Fassung von tidy() enthaelt noch das,
     was inzwischen aussortiert wird - der wird nicht wiederverwendet. */
  const alterStand = JSON.stringify([{ id: 1, name: 'Testband', songs: [{ t: 'Altlast', a: 'X' }] }]);
  const wAlt = makeWindow({ 'songrate:artists': alterStand });
  await waitFor(() => !wAlt.document.querySelector('#app').hidden);
  assert(wAlt.__ev('Artist.all().length') === 0
    && wAlt.document.querySelector('#modeSeg [data-v="artist"]').disabled,
    'Kuenstler: ein Katalog ohne Versionsstempel wird verworfen');

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
  /* Der gemeldete Fehler: Medium hatte mehr Streams als Easy, weil nach dem
     Rang im Jahrzehnt sortiert wurde. Jetzt zaehlen die Streams selbst. */
  assert(monotone(G), 'Genres: keine Stufe ist bekannter als die davor');
  const easyMinS = G('Math.min(...byTier.easy.filter(s => s.s > 0).map(s => s.s))');
  const medMaxS = G('Math.max(...byTier.medium.filter(s => s.s > 0).map(s => s.s), 0)');
  assert(G('byTier.easy.some(s => s.s > 0)') && easyMinS >= medMaxS,
    `Genres: jeder Easy-Song hat mehr Streams als jeder Medium-Song (${Math.round(easyMinS / 1e6)} >= ${Math.round(medMaxS / 1e6)} Mio.)`);
  assert(G("listFor('genres').every(o => filtered.filter(s => norm(Filters.genreOf(s)) === o.value).length >= GEN_MIN)"),
    'Genres: zu kleine Genres stehen nicht zur Wahl');

  const gWas = G('settings.genre');
  $('#pickNext').click(); await tick(40);
  assert(G('settings.genre') !== gWas, 'Genres: der Pfeil springt zum naechsten Genre');
  assert(G('round').every(r => r.song && G('pickFiltered').some(s => s.i === r.song.i)),
    'Genres: der Wechsel startet eine neue Runde aus dem neuen Genre');
  assert($('#gGenre').hidden, 'Genres: die Genre-Liste im Filterpanel ist hier ausgeblendet');
  assert(G('filterScope()') === gnow(), 'Genres: die Zeile der Songauswahl nennt das Genre');

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
  assert(/Playlist/.test(w2.document.querySelector('#filterPanel .psum').textContent),
    'Playlist-Filter: die Zeile sagt, worauf die Regeln wirken');
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
  assert(JSON.stringify(w2.__ev('settings.filters')) === chartRules && !/Playlist/.test(w2.document.querySelector('#filterPanel .psum').textContent),
    'Playlist-Filter: zurück im Chartsmodus gelten wieder die alten Regeln');

  /* ------------------------------- Playlist: einzeln hinzufuegen */
  /* Eine Playlist muss nicht aus einer Datei kommen - Suchfeld, Album
     anklicken, drin. */
  const w9 = makeWindow({});
  const P = n => w9.__ev(n), p$ = q => w9.document.querySelector(q);
  await waitFor(() => !w9.document.querySelector('#app').hidden);

  assert(P('PL') === null, 'Hinzufuegen: vorher gibt es keine Playlist');
  p$('#plFind').value = 'neuer song';
  p$('#plFind').dispatchEvent(new w9.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => p$('#plHits').querySelectorAll('.arhit').length > 0, 5000);
  const treffer = [...p$('#plHits').querySelectorAll('.arhit')];
  assert(treffer.length === 1 && /Neuer Song – Neue Band/.test(treffer[0].textContent),
    'Hinzufuegen: die Songsuche zeigt nur, was eine Hoerprobe hat');

  treffer[0].click();
  await waitFor(() => P('PL') != null, 3000);
  assert(P('PL.songs.length') === 1 && P("PL.songs[0].t") === 'Neuer Song',
    'Hinzufuegen: ein Klick legt den Song in die Playlist');
  assert(P("PL.songs[0].k") === 4242, 'Hinzufuegen: mit Apples Track-ID');
  assert(p$('#plFind').value === '' && p$('#plHits').children.length === 0,
    'Hinzufuegen: danach ist das Suchfeld wieder frei');

  /* Ein ganzes Album */
  p$('#plFindKind [data-v="album"]').click();
  p$('#plFind').value = 'loud rihanna';
  p$('#plFind').dispatchEvent(new w9.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => p$('#plHits').querySelectorAll('.arhit').length > 0, 5000);
  const alben = [...p$('#plHits').querySelectorAll('.arhit')];
  assert(/Loud – Rihanna/.test(alben[0].textContent) && /3 Titel/.test(alben[0].textContent),
    'Hinzufuegen: Alben stehen mit Titelzahl da');
  alben[0].click();
  await waitFor(() => P('PL.songs.length') === 3, 5000);
  assert(P("PL.songs.filter(s => s.al === 'Loud').length") === 2,
    'Hinzufuegen: das Album kommt komplett, ohne den Titel ohne Hoerprobe');
  assert(/Loud: 2 Titel dazu/.test(p$('#plFindNote').textContent),
    'Hinzufuegen: und die Meldung sagt, wie viele (' + p$('#plFindNote').textContent + ')');

  /* Zweimal dasselbe Album aendert nichts */
  p$('#plFind').value = 'loud rihanna';
  p$('#plFind').dispatchEvent(new w9.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => p$('#plHits').querySelectorAll('.arhit').length > 0, 5000);
  p$('#plHits').querySelector('.arhit').click();
  await waitFor(() => /schon drin/.test(p$('#plFindNote').textContent), 5000);
  assert(P('PL.songs.length') === 3, 'Hinzufuegen: dasselbe Album zweimal bleibt dasselbe');

  {
  /* ------------------------- Fehler erklaeren: das ?-Knoepfchen an der Meldung */
  const fehlSuche = async q => {
    p$('#plFind').value = q;
    p$('#plFind').dispatchEvent(new w9.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await waitFor(() => p$('#plFindNote .why'), 5000);
    return p$('#plFindNote .why');
  };
  p$('#plFindKind button[data-v="song"]').click();
  let why = await fehlSuche('kaputt lied');
  assert(p$('#plFindNote').textContent.startsWith('Die Suche hat nicht geklappt.') && why,
    'Fehler: an der Meldung haengt ein ?-Knopf');
  assert(/nicht angekommen/.test(why.title) && /itunes\.apple\.com/.test(why.title) && /Failed to fetch/.test(why.title)
    && /blocker/i.test(why.title),
    'Fehler: der Tooltip nennt Netzfehler, Adresse, Ursache und moegliche Gruende (' + why.title.slice(0, 50) + '…)');
  why.click();
  const box = p$('#plFindNote .whybox');
  assert(box && box.textContent === why.title, 'Fehler: Tippen klappt die Erklaerung darunter auf');
  why.click();
  assert(!p$('#plFindNote .whybox'), 'Fehler: nochmal Tippen klappt sie zu');
  why.click();
  w9.document.body.click();
  assert(!p$('#plFindNote .whybox'), 'Fehler: ein Klick daneben schliesst sie');
  why = await fehlSuche('fuenfhundert lied');
  assert(/HTTP 500/.test(why.title) && /Fehler auf dem Server/.test(why.title),
    'Fehler: ein HTTP-Status wird genannt und uebersetzt (' + why.title.split('\n')[0].slice(0, 60) + ')');
  assert(P("whyOf({ status: 500, url: 'https://musik.example.org/rest/ping?u=ben&t=abc123&s=salz&v=1.16' })").includes('t=…')
    && !P("whyOf({ status: 500, url: 'https://musik.example.org/rest/ping?u=ben&t=abc123&s=salz&v=1.16' })").includes('abc123'),
    'Fehler: Geheimnisse in der Adresse werden ausgeblendet');
  assert(/zu viele Anfragen/.test(P("whyOf({ throttled: true, status: 403, url: 'https://itunes.apple.com/search?term=x' })")),
    'Fehler: die Bremse wird erklaert');
  await fehlSuche('loud rihanna');
  await waitFor(() => !p$('#plFindNote .why'), 5000);
  assert(!p$('#plFindNote .why'), 'Fehler: eine gute Meldung hat keinen ?-Knopf');

  }
  /* Und es ueberlebt das Neuladen */
  const w9b = makeWindow({ 'songrate:playlist': w9.localStorage.getItem('songrate:playlist') });
  await waitFor(() => !w9b.document.querySelector('#app').hidden);
  assert(w9b.__ev('PL.songs.length') === 3, 'Hinzufuegen: die Playlist ist nach dem Neuladen noch da');

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

  L("settings.suggest = 'pool'; suggest('song')");
  assert(L('sugAll').length > 0 && L("sugAll.every(s => LO.songs.some(x => x.t === s.t))"),
    'Eigene Musik: mit „nur Auswahl" kommen die Vorschlaege nur aus der eigenen Musik');
  L("settings.suggest = 'all'");

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
  assert(l$('#revealLinks').querySelector('a').textContent === 'Apple Music'
    && l$('#revealLinks').querySelector('.more'),
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
  {
    const why = s$('#srvNote .why');
    assert(why && /musik\.kaputt\.org/.test(why.title) && /Failed to fetch/.test(why.title) && !/geheim/.test(why.title),
      'Server: der ?-Knopf nennt Adresse und Ursache, aber kein Passwort (' + (why ? why.title.slice(-80) : '-') + ')');
  }

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
     sich abbrechen; die Titelliste bleibt fuer „Weiter suchen" liegen. Was
     schon gefunden ist, laesst sich waehrenddessen spielen. */
  w = makeWindow({});
  await waitFor(() => !w.document.querySelector('#app').hidden);
  w.fetch = async url => String(url).includes('itunes')
    ? { ok: false, status: 403, json: async () => ({}) }
    : { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  const status = () => w.document.querySelector('#plStatus').textContent;
  const sub = () => w.document.querySelector('#plSub').textContent;
  w.__ev("loadPlaylistText('Track Name,Artist Name(s)\\nUnstoppable,Sia\\nBlinding Lights,The Weeknd\\n"
    + "Hello,Adele\\nbad guy,Billie Eilish\\nStronger,Britney Spears\\nLevitating,Dua Lipa\\nA,B\\nC,D', 'X')");
  await waitFor(() => /Apple bremst/.test(sub()));
  assert(/Apple bremst – weiter in \d+ s/.test(sub()), 'Drosselung: Wartezeit wird heruntergezaehlt (' + sub() + ')');
  assert(/6 von 8 durchsucht · 6 gefunden/.test(status()),
    'Drosselung: der Fortschritt bleibt dabei stehen (' + status() + ')');
  assert(!w.document.querySelector('#plBar').hidden, 'Drosselung: der Balken auch');
  assert(/^6\/8 · Pause \d+ s/.test(w.__ev("panelSum('playlist')[0]")),
    'Drosselung: die zugeklappte Zeile sagt es (' + w.__ev("panelSum('playlist')[0]") + ')');
  assert(!w.document.querySelector('#plCancel').hidden, 'Drosselung: Abbrechen ist sichtbar');
  assert(w.__ev('Playlist.pace().delay') >= 3000 && w.__ev('Playlist.pace().blocked') >= 1,
    'Drosselung: nach der Sperre wird der Takt langsam (' + w.__ev('Playlist.pace().delay') + ' ms)');
  await waitFor(() => w.__ev('mode') === 'playlist', 3000);
  assert(w.__ev('plBusy') && w.__ev('mode') === 'playlist'
    && w.__ev('round').every(r => w.__ev('PL.songs').some(s => s.t === r.song.t)),
    'Spielen waehrend der Suche: mit dem Gefundenen geht es schon los');

  /* Vorziehen, waehrend der Lauf wartet. */
  w.document.querySelector('#plView').click(); await tick(10);
  assert(w.__ev('impTab') === 'pending', 'Titelliste: waehrend der Suche zuerst das Offene');
  const offenRows = [...w.document.querySelectorAll('#impList .brow')];
  assert(offenRows.length === 2 && offenRows[0].textContent.includes('wird gerade gesucht'),
    'Titelliste: der vorderste Titel ist als laufend markiert');
  offenRows[1].querySelector('button[title="Vorziehen"]').click(); await tick(10);
  assert(w.__ev('plJob.pending[0].title') === 'C', 'Titelliste: Vorziehen stellt den Titel an die Spitze');
  assert(w.document.querySelector('#impList .brow').textContent.includes('C'), 'Titelliste: und zeigt ihn oben');
  w.document.querySelector('#impDone').click();

  w.document.querySelector('#plCancel').click();
  await waitFor(() => w.__ev('plBusy') === false);
  assert(w.__ev('plBusy') === false, 'Abbrechen: Lauf endet');
  assert(!w.document.querySelector('#plResume').hidden
    && /Weiter suchen \(2 offen\)/.test(w.document.querySelector('#plResume').textContent),
    'Abbrechen: „Weiter suchen" steht bereit');
  assert(w.__ev('Playlist.restoreQueue()') != null, 'Abbrechen: Titelliste bleibt gespeichert');

  /* Nach dem Neuladen ist der Auftrag wieder da - mit dem, was offen ist. */
  const merk = {};
  for (let i = 0; i < w.localStorage.length; i++) merk[w.localStorage.key(i)] = w.localStorage.getItem(w.localStorage.key(i));
  w = makeWindow(merk);
  await waitFor(() => !w.document.querySelector('#app').hidden);
  assert(w.__ev('plJob') && w.__ev('plJob.found.size') === 6 && w.__ev('plJob.pending.length') === 2,
    'Neuladen: der Auftrag steht wieder mit 6 gefunden und 2 offen');
  assert(w.__ev('PL.songs.length') === 6 && /Weiter suchen \(2 offen\)/.test(w.document.querySelector('#plResume').textContent),
    'Neuladen: Playlist und „Weiter suchen" sind da');

  /* ------------------------------------------- Sicherheit und Randfaelle */
  {
    /* Ein manipulierter Link-Cache liegt schon im Speicher, bevor die Seite startet. */
    w = makeWindow({ 'songrate:links': JSON.stringify({ 778: { spotify: 'javascript:alert(3)', deezer: 'https://www.deezer.com/track/778' } }) });
    await waitFor(() => !w.document.querySelector('#app').hidden);
    const R = x => w.__ev(x), r$ = q => w.document.querySelector(q);

    assert(R('typeof Links.exact') === 'undefined', 'Links: die Odesli-API wird nicht mehr angesprochen');
    const alt = R("Links.known({ k: 778 })");
    assert(alt && !alt.spotify && alt.deezer, 'Links: auch ein manipulierter Cache liefert nur https');
    assert(R("Links.forSong({ t: 'x', a: 'y', k: 778 }, 'spotify').every(l => /^https:\\/\\//.test(l.url))"),
      'Links: jede Adresse in der Aufloesung beginnt mit https');

    /* Leertaste im Textfeld der Playlist tippt ein Leerzeichen, spielt nichts ab. */
    let gespielt = 0;
    const altPlay = R('playCurrent');
    w.__ev('playCurrent = () => { window.__p = (window.__p || 0) + 1; }');
    const ta = r$('#plPaste');
    ta.hidden = false; ta.focus();
    const ev = new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    gespielt = R('window.__p || 0');
    assert(!ev.defaultPrevented && gespielt === 0, 'Tasten: die Leertaste im Textfeld bleibt ein Leerzeichen');
    const ev2 = new w.KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true });
    ta.dispatchEvent(ev2);
    assert(R('active') === 0, 'Tasten: eine Ziffer im Textfeld wechselt keinen Platz');
    w.document.body.focus();
    const ev3 = new w.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    w.document.body.dispatchEvent(ev3);
    assert(R('window.__p') === 1, 'Tasten: ausserhalb spielt die Leertaste ab');

    /* Audio: der Cache dekodierter Previews bleibt begrenzt. */
    for (let i = 0; i < 30; i++) await R(`Audio2.load('https://audio/cache${i}.m4a')`);
    assert(R('Audio2.cached()') <= 12, 'Audio: der Cache dekodierter Previews bleibt begrenzt (' + R('Audio2.cached()') + ' von 30)');
    const nochDa = await Promise.all([0, 29].map(i => R(`Audio2.load('https://audio/cache${i}.m4a').then(() => true)`)));
    assert(nochDa.every(Boolean), 'Audio: alte Previews lassen sich wieder laden');

    /* Stufenlabel bleibt lesbar, wenn ein fertiger Platz eine Stufe hat, die es nicht mehr gibt. */
    R("round[0].status = 'won'; round[0].stage = 5; settings.ladder = [0.5, 2]; setLadder([0.5, 2]); active = 0; render()");
    assert(r$('#stageLabel').textContent === '2s', 'Stufen: ein fertiger Platz jenseits der Leiter zeigt die letzte Laenge (' + r$('#stageLabel').textContent + ')');

    /* Gespeicherte Grenzen, von Hand verbogen, werden beim Laden repariert. */
    const wT = makeWindow({ 'songrate:settings': JSON.stringify({ tiers: { global: [90, 5, 'x', 200, 1], scopes: { charts: [50, 50, 50, 50, 50] } } }) });
    await waitFor(() => !wT.document.querySelector('#app').hidden);
    const steigend = a => a.length === 5 && a.every((v, i) => Number.isInteger(v) && v >= 1 && v <= 100 && (!i || v > a[i - 1]));
    assert(steigend(wT.__ev('settings.tiers.global')) && steigend(wT.__ev('settings.tiers.scopes.charts'))
      && wT.__ev('settings.tiers.global')[0] === 90 && wT.__ev('settings.tiers.global')[4] === 100,
      'Schwierigkeit: kaputte gespeicherte Grenzen werden steigend gemacht (' + wT.__ev('settings.tiers.global').join() + ' / ' + wT.__ev('settings.tiers.scopes.charts').join() + ')');

    /* Ohne Songliste bleibt die Seite nicht stumm stehen. */
    failSongs = true;
    const wB = makeWindow({});
    failSongs = false;
    await waitFor(() => /nicht laden/.test(wB.document.querySelector('#boot p').textContent), 3000);
    assert(/nicht laden/.test(wB.document.querySelector('#boot p').textContent) && wB.document.querySelector('#boot').classList.contains('failed'),
      'Start: ohne Songliste steht eine Meldung da');
  }

  { /* eigener Block: die Namen hier gibt es weiter oben schon */
  /* ------------------------------------------------------------ Spotify */
  w = makeWindow({});
  await waitFor(() => !w.document.querySelector('#app').hidden);
  let ziel = null;
  w.__ev('Spotify.nav').go = u => { ziel = u; };
  const sp$ = q => w.document.querySelector(q);
  assert(sp$('#spRedirect').textContent === 'https://example.org/', 'Spotify: die Redirect-Adresse steht zum Abschreiben da');
  assert(!sp$('#spLogin').hidden && sp$('#spLogout').hidden,
    'Spotify: abgemeldet steht der Anmeldeknopf da');
  assert(!sp$('#spFixedNote').hidden && sp$('#spSetup').hidden, 'Spotify: mit eingebauter App bleibt die Anleitung eingeklappt');
  sp$('#spLogin').click();
  await waitFor(() => ziel, 3000);
  assert(ziel && new URL(ziel).searchParams.get('client_id') === 'a26fcfca3c684360805f5e0b8112ff4c',
    'Spotify: ohne eigene ID geht es mit der eingebauten los');
  ziel = null;
  sp$('#spOwnToggle').click();
  assert(!sp$('#spSetup').hidden, 'Spotify: „eigene App" klappt die Anleitung auf');
  sp$('#spClient').value = 'test-client';
  sp$('#spLogin').click();
  await waitFor(() => ziel, 3000);
  const auth = new URL(ziel);
  assert(auth.origin === 'https://accounts.spotify.com' && auth.searchParams.get('code_challenge_method') === 'S256'
    && auth.searchParams.get('code_challenge').length === 43 && auth.searchParams.get('client_id') === 'test-client'
    && auth.searchParams.get('redirect_uri') === 'https://example.org/'
    && /playlist-read-private/.test(auth.searchParams.get('scope')),
    'Spotify: Anmeldung mit PKCE (S256), Client ID und Redirect-Adresse');
  const gemerkt = JSON.parse(w.localStorage.getItem('songrate:spotify'));
  assert(gemerkt.verifier && gemerkt.verifier.length === 64 && gemerkt.state === auth.searchParams.get('state'),
    'Spotify: Verifier und State bleiben fuer die Rueckkehr liegen');

  /* Rueckkehr mit falschem State: abgelehnt, ohne Token-Anfrage. */
  spotifyCalls = [];
  w = makeWindow({ 'songrate:spotify': JSON.stringify(gemerkt) }, null, 'https://example.org/?code=abc&state=falsch');
  await waitFor(() => !w.document.querySelector('#app').hidden);
  await waitFor(() => /passt nicht/.test(w.document.querySelector('#spNote').textContent), 3000);
  assert(!spotifyCalls.length && /passt nicht/.test(w.document.querySelector('#spNote').textContent),
    'Spotify: eine fremde Rueckmeldung wird nicht eingeloest');

  /* Die echte Rueckkehr. */
  spotifyCalls = [];
  w = makeWindow({ 'songrate:spotify': JSON.stringify(gemerkt) }, null,
    'https://example.org/?code=abc&state=' + gemerkt.state);
  await waitFor(() => !w.document.querySelector('#app').hidden);
  const S = s2 => w.__ev(s2), s$ = q => w.document.querySelector(q);
  await waitFor(() => s$('#spLists').children.length > 0, 3000);
  assert(spotifyCalls[0] === 'token:authorization_code', 'Spotify: der Code wird gegen ein Token getauscht');
  assert(w.location.search === '', 'Spotify: die Adresse ist danach wieder sauber');
  assert(s$('#plPanel').open && s$('#spBox').open, 'Spotify: nach der Rueckkehr steht die Liste offen da');
  assert(s$('#spSetup').hidden && s$('#spLogin').hidden && !s$('#spLogout').hidden, 'Spotify: angemeldet');
  const zeilen = [...s$('#spLists').querySelectorAll('.arhit')];
  assert(zeilen.length === 4 && zeilen[0].textContent.includes('Lieblingssongs'),
    'Spotify: Lieblingssongs und die drei Playlists');
  const fremd = zeilen.find(z => z.textContent.includes('Discover Weekly'));
  assert(!fremd.disabled && fremd.classList.contains('dim') && /gehört Spotify/.test(fremd.textContent)
    && !zeilen.find(z => z.textContent.includes('Gemeinsam')).classList.contains('dim'),
    'Spotify: fremde Playlists stehen abgeblendet da, mit Besitzer, gemeinsame nicht');
  fremd.click();
  await waitFor(() => /gibt Spotify nicht heraus/.test(s$('#spNote').textContent), 3000);
  assert(/Discover Weekly gibt Spotify nicht heraus/.test(s$('#spNote').textContent) && S('plJob') == null,
    'Spotify: antippen versucht es, und die Absage nennt den Grund (' + s$('#spNote').textContent.slice(0, 60) + ')');
  zeilen.find(z => z.textContent.includes('Meine Klassiker')).click();
  await waitFor(() => S('plJob') && S('plJob.name') === 'Meine Klassiker' && !S('plBusy'), 8000);
  assert(S('plJob.tracks.length') === 3, 'Spotify: zwei Seiten geholt, die Episode faellt raus');
  assert(S("plJob.tracks.find(t => t.title === 'September').lead") === 'Earth, Wind & Fire',
    'Spotify: der erste Kuenstler bleibt ein Name, auch mit Komma');
  assert(S("plJob.tracks.find(t => t.title.startsWith('Levitating')).artist") === 'Dua Lipa;DaBaby',
    'Spotify: mehrere Kuenstler wie bei Exportify');
  assert(S("[...plJob.found.values()].filter(f => f.via === 'local').length") === 3,
    'Spotify: alle drei stehen in songs.json und kosten keine Anfrage, auch „Earth, Wind & Fire"');

  /* Ein abgelaufenes Token wird still erneuert. */
  const st = JSON.parse(w.localStorage.getItem('songrate:spotify'));
  st.exp = 0;
  w.localStorage.setItem('songrate:spotify', JSON.stringify(st));
  spotifyCalls = [];
  w.__ev('spLists = null; loadSpotifyLists()');
  await waitFor(() => w.__ev('spLists'), 3000);
  assert(spotifyCalls[0] === 'token:refresh_token' && w.__ev('spLists.length') === 3,
    'Spotify: ein abgelaufenes Token wird mit dem Refresh-Token erneuert');

  /* Eine Antwort, die mit dem Token woandershin verweist, wird nicht befolgt. */
  spotifyCalls = [];
  let fremdFehler = '';
  await w.__ev("Spotify.tracks('pl4').catch(e => { window.__fremd = e.message; })");
  await waitFor(() => w.__ev('window.__fremd'), 3000);
  fremdFehler = w.__ev('window.__fremd') || '';
  assert(/fremde Adresse/.test(fremdFehler) && !spotifyCalls.some(c => /evil/.test(c)),
    'Spotify: ein `next` auf einen fremden Host bekommt das Token nicht (' + fremdFehler + ')');

  s$('#spLogout').click();
  assert(!w.__ev('Spotify.loggedIn()') && !s$('#spLogin').hidden
    && JSON.parse(w.localStorage.getItem('songrate:spotify')).clientId === 'test-client',
    'Spotify: abmelden vergisst die Tokens, die Client ID bleibt');

  }

  console.log(failed ? `\n${failed} Fehler` : '\nAlles durchgespielt');
  process.exit(failed ? 1 : 0);
})();
