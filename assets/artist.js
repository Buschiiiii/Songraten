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
  /* Hochzaehlen, sobald tidy() anders aussortiert - siehe all(). */
  const CACHE_VER = 2;
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
      k: t.trackId,        /* Apples Track-ID: macht den Sammellink moeglich */
    };
  }

  /* Steht der Name als eigenes Wort drin? `norm` macht aus allem
     "wort wort wort", also reichen Leerzeichen als Grenze. */
  const wort = (heuhaufen, nadel) => ` ${heuhaufen} `.includes(` ${nadel} `);

  /* Gastauftritte stehen als "(feat. X)", "ft. X" oder "with X" im Titel. */
  const FEAT = /\b(?:feat|ft|featuring|with)\b\.?\s*/i;

  /* Gehoert der Song wirklich zu diesem Kuenstler?

     Der Titel allein reicht dafuer **nicht**: "A$AP & Rihanna" ist ein Song
     von CELINE und hatte sich so in eine Rihanna-Runde geschmuggelt. Es
     zaehlt also nur, was den Kuenstler wirklich ausweist - Apples artistId,
     sein Name als eigenes Wort im Kuenstlerfeld, oder eine Feature-Angabe
     im Titel, hinter der sein Name steht. */
  function belongs(t, artist) {
    if (artist.id != null && t.artistId === artist.id) return true;
    const n = norm(artist.name);
    if (wort(norm(t.artistName), n)) return true;
    const teile = String(t.trackName || '').split(FEAT);
    return teile.length > 1 && teile.slice(1).some(x => wort(norm(x), n));
  }

  /* Dubletten: Apple fuehrt denselben Song auf Single, Album und Deluxe. Es
     bleibt die aelteste Fassung - das ist meistens das Original. */
  function tidy(tracks, artist) {
    const best = new Map();
    tracks.forEach(t => {
      if (!t.previewUrl || !t.trackName) return;
      if (!belongs(t, artist)) return;
      if (BAD.test(t.trackName) || BAD.test(t.collectionName || '')) return;
      const key = norm(t.trackName);
      const alt = best.get(key);
      if (!alt || (t.releaseDate || '9') < (alt.releaseDate || '9')) best.set(key, t);
    });
    return plain([...best.values()]).map(toSong);
  }

  /* Der Titel ohne seine angehaengten Klammerzusaetze. Wiederholt, weil
     "Only Girl (In the World) [Extended Club]" zwei davon hat. */
  function base(titel) {
    let s = String(titel || '');
    for (let i = 0; i < 4; i++) {
      const kurz = s.replace(/\s*[([][^)\]]*[)\]]\s*$/, '');
      if (kurz === s) break;
      s = kurz;
    }
    return norm(s) || norm(titel);
  }

  /* Fassungen, die man am Anfang nicht auseinanderhalten kann: steht
     derselbe Song auch ohne Zusatz im Katalog, bleibt nur der schlichte.
     "Only Girl (In the World)" und "... [Extended Club]" klingen die ersten
     Sekunden gleich - die Wahl zwischen beiden waere geraten, nicht
     gewusst. Gibt es nur die eine Fassung, bleibt sie natuerlich. */
  function plain(tracks) {
    const gruppen = new Map();
    tracks.forEach(t => {
      const k = base(t.trackName);
      const alt = gruppen.get(k);
      if (!alt || t.trackName.length < alt.trackName.length) gruppen.set(k, t);
    });
    return [...gruppen.values()];
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

    const entry = { id: artist.id, name: artist.name, v: CACHE_VER,
                    songs: tidy([...katalog, ...gaeste], artist) };
    if (entry.songs.length >= MIN_SONGS) store(entry);
    return entry;
  }

  /* --------------------------------------------------------- Speicher */

  /* Nach einer Aenderung an `tidy()` taugen die gespeicherten Kataloge
     nichts mehr - im Speicher stecken dann noch die Songs, die gerade erst
     aussortiert wurden. Deshalb die Version: was nicht passt, wird beim
     naechsten Besuch einfach neu geholt. */
  function all() {
    try {
      const liste = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      return Array.isArray(liste) ? liste.filter(a => a && a.v === CACHE_VER) : [];
    } catch (e) { return []; }
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

  return { find, load, all, fromCache, forget, tidy, base, MIN_SONGS };
})();
