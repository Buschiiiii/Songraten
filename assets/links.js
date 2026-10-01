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
   dem Song und drueckt Play. Die genauen Adressen je Dienst kamen frueher von
   Odeslis API; die ist seit Herbst 2025 ohne Schluessel dicht (siehe unten),
   es bleibt der Sammellink. */

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

  /* ------------------------------------------ Genaue Links (Cache) */

  /* song.links API (api.song.link) hat die Seite frueher je Song einmal
     gefragt und die Suchadressen durch die genauen ersetzt. Seit Herbst 2025
     antwortet sie nur noch mit 401 „PUBLIC_API_ACCESS_DEPRECATED" - ohne
     Schluessel geht da nichts mehr, und ein Schluessel ist hier verboten.
     Was damals beantwortet wurde, liegt noch in `songrate:links` und wird
     weiter genutzt; neu gefragt wird nicht. Der Sammellink song.link/i/<k>
     ist eine Webseite, keine API, und geht weiter. */
  const CACHE_KEY = 'songrate:links';

  let cache = null;
  function load() {
    if (cache) return cache;
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { cache = {}; }
    return cache;
  }

  /* Was von aussen kommt, landet als href im Dokument - also nur echte
     https-Adressen, nie etwas wie javascript:. */
  const safe = u => (typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u) ? u : '');

  /* Was schon bekannt ist, ohne Anfrage. Auch der Cache wird geprueft - er
     stammt aus demselben localStorage, in dem jeder Tab schreiben darf. */
  function known(song) {
    const hit = song && song.k ? load()[String(song.k)] : null;
    if (!hit) return null;
    const out = {};
    Object.keys(hit).forEach(k => { if (safe(hit[k])) out[k] = hit[k]; });
    return out;
  }

  return { SERVICES, forSong, one, name, has, known, DEFAULT: 'apple' };
})();
