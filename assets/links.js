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
  function known(song) {
    return song && song.k ? (load()[String(song.k)] || null) : null;
  }

  function pick(links, id) {
    for (const key of (PLATFORM[id] || [])) {
      const hit = links[key];
      if (hit && hit.url) return hit.url;
    }
    return '';
  }

  /* Holt die genauen Adressen. Gibt {} zurueck, wenn nichts zu holen war -
     der Aufrufer bleibt dann einfach bei den Suchlinks. */
  async function exact(song) {
    if (!song || !song.k) return null;
    const key = String(song.k);
    const hit = load()[key];
    if (hit) return hit;

    const jetzt = Date.now();
    stamps = stamps.filter(t => jetzt - t < 60000);
    if (stamps.length >= RATE) return null;
    stamps.push(jetzt);

    try {
      const url = `${API}?platform=itunes&type=song&id=${encodeURIComponent(key)}&userCountry=DE`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      const links = data.linksByPlatform || {};
      const out = {};
      Object.keys(PLATFORM).forEach(id => { const u = pick(links, id); if (u) out[id] = u; });
      if (data.pageUrl) out.songlink = data.pageUrl;
      store(key, out);
      return out;
    } catch (e) { return null; }
  }

  return { SERVICES, forSong, one, name, has, exact, known, DEFAULT: 'apple' };
})();
