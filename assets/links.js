/* Wo man den Song nachhoeren kann.

   Kein Dienst laesst sich ohne registrierte App und Login abfragen, aber
   jeder hat eine Suchseite, die sich per URL aufrufen laesst - das reicht:
   Titel und Kuenstler hineinschreiben, der Dienst findet den Rest. Damit
   kostet die Liste keine einzige Anfrage und funktioniert auch fuer Songs,
   die nur lokal auf der Platte liegen.

   Genauer geht es, wenn Apples Track-ID bekannt ist (`k`): song.link (Odesli)
   loest sie in einen Link je Dienst auf - und zwar auf die richtige Aufnahme
   statt auf eine Suche. Die ID liefert die Pipeline mit; bei Playlist- und
   Kuenstlerkatalogen kommt sie direkt von Apple. Fehlt sie (aeltere
   songs.json, lokale Dateien), bleibt es bei der Suche.

   Angemeldet ist man dabei sowieso: der Link geht in den eigenen Browser,
   und dort laeuft die Sitzung bei Spotify, Tidal oder Qobuz weiter. Was der
   genaue Link spart, ist der Umweg ueber die Trefferliste - man landet auf
   dem Song und drueckt Play. `exact()` holt die genauen Adressen einmal je
   Song von Odesli und merkt sie sich; klappt das nicht, bleibt die Suche. */

const Links = (() => {

  const term = s => [s.t, s.a].filter(Boolean).join(' ');
  const q = s => encodeURIComponent(term(s));
  /* Deezer und Amazon haengen die Suche in den Pfad, da stoert ein Schraegstrich. */
  const path = s => encodeURIComponent(term(s).replace(/\//g, ' '));

  /* Reihenfolge = Reihenfolge in der Auswahl. Alle Adressen sind oeffentliche
     Suchseiten, keine API. */
  const SERVICES = [
    { id: 'apple',      name: 'Apple Music',   url: s => 'https://music.apple.com/de/search?term=' + q(s) },
    { id: 'spotify',    name: 'Spotify',       url: s => 'https://open.spotify.com/search/' + path(s) },
    { id: 'ytmusic',    name: 'YouTube Music', url: s => 'https://music.youtube.com/search?q=' + q(s) },
    { id: 'youtube',    name: 'YouTube',       url: s => 'https://www.youtube.com/results?search_query=' + q(s) },
    { id: 'deezer',     name: 'Deezer',        url: s => 'https://www.deezer.com/search/' + path(s) },
    { id: 'tidal',      name: 'Tidal',         url: s => 'https://listen.tidal.com/search?q=' + q(s) },
    /* play.qobuz.com ist der Player; qobuz.com selbst ist der Kaufladen. */
    { id: 'qobuz',      name: 'Qobuz',         url: s => 'https://play.qobuz.com/search/' + path(s) },
    { id: 'amazon',     name: 'Amazon Music',  url: s => 'https://music.amazon.de/search/' + path(s) },
    { id: 'soundcloud', name: 'SoundCloud',    url: s => 'https://soundcloud.com/search?q=' + q(s) },
    /* Kein Streaming, sondern Kaufen und Nachschlagen - stehen deshalb hinten. */
    { id: 'bandcamp',   name: 'Bandcamp',      shop: true, url: s => 'https://bandcamp.com/search?q=' + q(s) },
    { id: 'qobuzshop',  name: 'Qobuz-Shop',    shop: true, url: s => 'https://www.qobuz.com/de-de/search?q=' + q(s) },
    { id: 'discogs',    name: 'Discogs',       shop: true, url: s => 'https://www.discogs.com/search/?type=release&q=' + q(s) },
  ];

  const byId = Object.fromEntries(SERVICES.map(s => [s.id, s]));

  /* Der Sammellink steht nur zur Verfuegung, wenn Apples Track-ID da ist. */
  const ALL = { id: 'songlink', name: 'Alle Dienste', hint: 'song.link',
                url: s => 'https://song.link/i/' + s.k };

  const has = id => id === ALL.id || !!byId[id];

  /* Die Liste fuer die Aufloesung: der Lieblingsdienst zuerst, davor - wenn
     moeglich - der Sammellink. */
  function forSong(song, favourite) {
    if (!song) return [];
    const genau = known(song) || {};
    const out = [];
    if (song.k) out.push({ ...ALL, url: genau.songlink || ALL.url(song), all: true });
    const rest = SERVICES.slice();
    const i = rest.findIndex(s => s.id === favourite);
    if (i > 0) rest.unshift(rest.splice(i, 1)[0]);
    rest.forEach(s => out.push({ id: s.id, name: s.name, shop: !!s.shop,
                                exact: !!genau[s.id], url: genau[s.id] || s.url(song) }));
    return out;
  }

  /* Ein einzelner Link, z. B. fuer die Ergebnisliste. */
  function one(song, id) {
    const s = byId[id] || byId.apple;
    if (!song) return '';
    const genau = known(song);
    return (genau && genau[s.id]) || s.url(song);
  }

  const name = id => (byId[id] || {}).name || '';

  /* ------------------------------------------ Genaue Links (Odesli) */

  /* Odesli kennt die meisten Dienste unter eigenen Namen; wo mehrere passen,
     gewinnt der erste. Qobuz und Bandcamp fuehrt es nicht - dort bleibt es
     bei der Suche, und das ist auch in Ordnung: eingeloggt ist man ja, es
     kostet nur einen Klick mehr. */
  const PLATFORM = {
    apple: ['appleMusic', 'itunes'],
    spotify: ['spotify'],
    ytmusic: ['youtubeMusic'],
    youtube: ['youtube'],
    deezer: ['deezer'],
    tidal: ['tidal'],
    amazon: ['amazonMusic', 'amazonStore'],
    soundcloud: ['soundcloud'],
  };

  const API = 'https://api.song.link/v1-alpha.1/links';
  const CACHE_KEY = 'songrate:links';
  const CACHE_MAX = 300;
  /* Ohne Schluessel laesst Odesli rund zehn Anfragen je Minute durch. Mehr
     braucht es nicht - eine Runde hat fuenf Aufloesungen -, aber gebremst
     wird trotzdem, damit ein hektisches Neuwuerfeln nicht ins Limit rennt. */
  const RATE = 8;
  let stamps = [];

  let cache = null;
  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { cache = {}; }
    return cache;
  }
  function store(k, val) {
    const c = load();
    c[k] = val;
    const keys = Object.keys(c);
    if (keys.length > CACHE_MAX) keys.slice(0, keys.length - CACHE_MAX).forEach(x => delete c[x]);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {}
  }

  /* Was schon bekannt ist, ohne Anfrage. */
  /* Auch der Cache wird geprueft - er stammt aus demselben localStorage,
     in dem jeder Tab schreiben darf. */
  function known(song) {
    const hit = song && song.k ? load()[String(song.k)] : null;
    if (!hit) return null;
    const out = {};
    Object.keys(hit).forEach(k => { if (safe(hit[k])) out[k] = hit[k]; });
    return out;
  }

  /* Was von aussen kommt, landet als href im Dokument - also nur echte
     https-Adressen, nie etwas wie javascript:. */
  const safe = u => (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) ? u : '');

  function pick(links, id) {
    for (const key of (PLATFORM[id] || [])) {
      const hit = links[key];
      if (hit && safe(hit.url)) return hit.url;
    }
    return '';
  }

  /* Die Bremse: eine Anfrage je Platz. `warten` = false (Aufloesung): ist
     kein Platz frei, gibt es keinen - die Suche steht ja schon. `warten` =
     true (Import): bis der naechste Platz frei wird. */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function platz(warten) {
    for (;;) {
      const jetzt = Date.now();
      stamps = stamps.filter(t => jetzt - t < 60000);
      if (stamps.length < RATE) { stamps.push(jetzt); return true; }
      if (!warten) return false;
      await sleep(Math.max(250, stamps[0] + 60000 - jetzt));
    }
  }

  async function odesli(params, warten) {
    if (!await platz(warten)) return null;
    const url = `${API}?${new URLSearchParams({ ...params, userCountry: 'DE' })}`;
    const res = await fetch(url);
    if (res.status === 429 && warten) {
      /* Einmal abwarten und noch einmal; danach ist es eben nichts. */
      await sleep(15000);
      return odesli(params, false);
    }
    if (!res.ok) return null;
    return res.json();
  }

  /* Der Umweg fuer den Import: Apples Suche verschweigt seit 2025 explizite
     Titel, der ISRC-Nachschlag auch. song.link kennt die Aufnahme aber ueber
     ihre Spotify-ID und nennt dazu Apples Track-ID - und ueber die kommt
     man per `lookup?id=` wieder an die Preview. Liefert die ID als String
     oder null; was einmal beantwortet wurde, bleibt im Speicher. */
  async function appleIdFor(platform, id) {
    if (!platform || !id) return null;
    const key = platform + ':' + id;
    const hit = load()[key];
    if (hit && hit.itunes) return hit.itunes;
    let data = null;
    try { data = await odesli({ platform, type: 'song', id: String(id) }, true); }
    catch (e) { return null; }
    if (!data) return null;
    let found = '';
    Object.values(data.entitiesByUniqueId || {}).forEach(e => {
      if (!found && e && e.apiProvider === 'itunes' && e.type === 'song' && /^\d+$/.test(String(e.id || ''))) {
        found = String(e.id);
      }
    });
    if (!found) {
      /* Zur Sicherheit auch der Link: …/album/x/123?i=456 traegt die ID. */
      const l = (data.linksByPlatform || {}).appleMusic || (data.linksByPlatform || {}).itunes;
      const m = l && safe(l.url) && /[?&]i=(\d+)/.exec(l.url);
      if (m) found = m[1];
    }
    /* Nur Treffer werden gemerkt - ein „kennt Apple nicht" kann sich
       aendern, und ein neuer Versuch soll wirklich fragen. */
    if (found) store(key, { itunes: found });
    return found || null;
  }

  /* Holt die genauen Adressen. Gibt {} zurueck, wenn nichts zu holen war -
     der Aufrufer bleibt dann einfach bei den Suchlinks. */
  async function exact(song) {
    if (!song || !song.k) return null;
    const key = String(song.k);
    const hit = load()[key];
    if (hit) return hit;

    try {
      const data = await odesli({ platform: 'itunes', type: 'song', id: key }, false);
      if (!data) return null;
      const links = data.linksByPlatform || {};
      const out = {};
      Object.keys(PLATFORM).forEach(id => { const u = pick(links, id); if (u) out[id] = u; });
      if (safe(data.pageUrl)) out.songlink = data.pageUrl;
      store(key, out);
      return out;
    } catch (e) { return null; }
  }

  return { SERVICES, forSong, one, name, has, exact, known, appleIdFor, DEFAULT: 'apple' };
})();
