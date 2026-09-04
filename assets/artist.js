/* Kuenstlermodus: alle Songs eines beliebigen Kuenstlers holen.

   In songs.json stecken nur 262 Kuenstler mit fuenf oder mehr Songs - fuer
   eine Runde ueber einen bestimmten Kuenstler reicht das nicht. Deshalb wird
   sein Katalog bei Bedarf direkt bei Apple geholt, so wie im Playlist-Modus.

   Zwei Anfragen, weil eine nicht genuegt: `attribute=artistTerm` liefert den
   Katalog des Kuenstlers, kennt aber seine Gastauftritte kaum - Apple fuehrt
   die meist nur im Titel ("Song (feat. X)"). Die normale Suche nach dem Namen
   findet genau die. Zusammen ergibt das ein brauchbares Gesamtbild. */

const Artist = (() => {

  const CACHE_KEY = 'songrate:artists';
  const KEEP = 12;             /* so viele Kuenstler bleiben gespeichert */
  const MIN_SONGS = 5;         /* darunter laesst sich keine Runde bauen */
  const LIMIT = 200;

  /* Fassungen, gegen die zu raten keinen Spass macht. */
  const BAD = new RegExp([
    'remix', 'live\\b', 'karaoke', 'instrumental', 'version', 'edit\\b', 'mix\\b',
    'remaster', 'sped up', 'slowed', 'acoustic', 'demo\\b', 'cover\\b', 'tribute',
    'made popular', 'a cappella', 'acapella', 'medley', 'mashup', 'commentary',
    'reprise', 'interlude',
  ].join('|'), 'i');

  const norm = s => (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  async function get(params) {
    const url = 'https://itunes.apple.com/search?' + new URLSearchParams(params);
    const res = await fetch(url);
    if (res.status === 403 || res.status === 429) {
      const e = new Error('throttled');
      e.throttled = true;
      throw e;
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()).results || [];
  }

  /* Erst den Kuenstler selbst suchen: "billie" soll eine Auswahl ergeben,
     keine wilde Songsuche. */
  async function find(name) {
    const hits = await get({ term: name, entity: 'musicArtist', limit: 12, country: 'DE' });
    const seen = new Set();
    return hits
      .filter(a => a.artistName && !seen.has(a.artistId) && seen.add(a.artistId))
      .map(a => ({ id: a.artistId, name: a.artistName, genre: a.primaryGenreName || '' }));
  }

  function toSong(t) {
    return {
      t: t.trackName,
      a: t.artistName,
      al: t.collectionName || '',
      y: t.releaseDate ? +t.releaseDate.slice(0, 4) : 0,
      g: t.primaryGenreName || '',
      s: 0,
      p: t.previewUrl,
      c: t.artworkUrl100 || '',
      id: t.trackId,
    };
  }

  /* Dubletten: Apple fuehrt denselben Song auf Single, Album und Deluxe. Es
     bleibt die aelteste Fassung - das ist meistens das Original. */
  function tidy(tracks, wanted) {
    const n = norm(wanted);
    const best = new Map();
    tracks.forEach(t => {
      if (!t.previewUrl || !t.trackName) return;
      const gehoert = norm(t.artistName).includes(n) || norm(t.trackName).includes(n);
      if (!gehoert) return;
      if (BAD.test(t.trackName) || BAD.test(t.collectionName || '')) return;
      const key = norm(t.trackName);
      const alt = best.get(key);
      if (!alt || (t.releaseDate || '9') < (alt.releaseDate || '9')) best.set(key, t);
    });
    return [...best.values()].map(toSong);
  }

  /* Holt den Katalog. Zuerst der Cache - ein zweiter Besuch beim selben
     Kuenstler kostet dann keine Anfrage mehr. */
  async function load(artist, opts) {
    opts = opts || {};
    const hit = fromCache(artist.id);
    if (hit && !opts.fresh) return hit;

    if (opts.onProgress) opts.onProgress('Katalog …');
    const katalog = await get({ term: artist.name, entity: 'song', attribute: 'artistTerm',
                                limit: LIMIT, country: 'DE' });
    if (opts.onProgress) opts.onProgress('Gastauftritte …');
    let gaeste = [];
    try {
      gaeste = await get({ term: artist.name, entity: 'song', limit: LIMIT, country: 'DE' });
    } catch (e) {
      if (e.throttled) throw e;      /* der Katalog allein taugt auch */
    }

    const entry = { id: artist.id, name: artist.name, songs: tidy([...katalog, ...gaeste], artist.name) };
    if (entry.songs.length >= MIN_SONGS) store(entry);
    return entry;
  }

  /* --------------------------------------------------------- Speicher */

  function all() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]'); } catch (e) { return []; }
  }

  function fromCache(id) {
    return all().find(a => String(a.id) === String(id)) || null;
  }

  function store(entry) {
    try {
      const rest = all().filter(a => String(a.id) !== String(entry.id));
      localStorage.setItem(CACHE_KEY, JSON.stringify([entry, ...rest].slice(0, KEEP)));
    } catch (e) {}
  }

  function forget(id) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(all().filter(a => String(a.id) !== String(id))));
    } catch (e) {}
  }

  return { find, load, all, fromCache, forget, MIN_SONGS };
})();
