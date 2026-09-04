/* Wo man den Song nachhoeren kann.

   Kein Dienst laesst sich ohne registrierte App und Login abfragen, aber
   jeder hat eine Suchseite, die sich per URL aufrufen laesst - das reicht:
   Titel und Kuenstler hineinschreiben, der Dienst findet den Rest. Damit
   kostet die Liste keine einzige Anfrage und funktioniert auch fuer Songs,
   die nur lokal auf der Platte liegen.

   Genauer geht es, wenn Apples Track-ID bekannt ist (`k`): song.link (Odesli)
   loest sie in einen Link je Dienst auf - Spotify, Tidal, Deezer, Qobuz,
   Amazon, YouTube in einem Aufwasch, und zwar auf die richtige Aufnahme statt
   auf eine Suche. Die ID liefert die Pipeline mit; bei Playlist- und
   Kuenstlerkatalogen kommt sie direkt von Apple. Fehlt sie (aeltere
   songs.json, lokale Dateien), bleibt es bei der Suche. */

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
    { id: 'qobuz',      name: 'Qobuz',         url: s => 'https://www.qobuz.com/de-de/search?q=' + q(s) },
    { id: 'amazon',     name: 'Amazon Music',  url: s => 'https://music.amazon.de/search/' + path(s) },
    { id: 'soundcloud', name: 'SoundCloud',    url: s => 'https://soundcloud.com/search?q=' + q(s) },
    { id: 'bandcamp',   name: 'Bandcamp',      url: s => 'https://bandcamp.com/search?q=' + q(s) },
    { id: 'discogs',    name: 'Discogs',       url: s => 'https://www.discogs.com/search/?type=release&q=' + q(s) },
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
    const out = [];
    if (song.k) out.push({ ...ALL, url: ALL.url(song), all: true });
    const rest = SERVICES.slice();
    const i = rest.findIndex(s => s.id === favourite);
    if (i > 0) rest.unshift(rest.splice(i, 1)[0]);
    rest.forEach(s => out.push({ id: s.id, name: s.name, url: s.url(song) }));
    return out;
  }

  /* Ein einzelner Link, z. B. fuer die Ergebnisliste. */
  function one(song, id) {
    const s = byId[id] || byId.apple;
    return song ? s.url(song) : '';
  }

  const name = id => (byId[id] || {}).name || '';

  return { SERVICES, forSong, one, name, has, DEFAULT: 'apple' };
})();
