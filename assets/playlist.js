/* Playlist-Modus: Datei einlesen, Titel gegen die iTunes-Suche aufloesen.
   Direkt bei Spotify/Apple/YouTube nachfragen geht nicht - deren APIs wollen
   OAuth mit registrierter App und Login, also einen Server. Der Umweg ueber
   einen Export (CSV/TSV/TXT/JSON) kommt ohne beides aus. */

const Playlist = (() => {

  const MAX_TRACKS = 300;
  const CACHE_KEY = 'songrate:plcache';
  const STORE_KEY = 'songrate:playlist';
  const QUEUE_KEY = 'songrate:plqueue';
  const CACHE_MAX = 900;
  /* Apple laesst ein paar hundert Anfragen durch und macht dann fuer eine
     Weile mit 403 dicht. Deshalb Pause zwischen den Anfragen und, wenn es
     doch passiert, warten statt abbrechen. */
  const PAUSE_MS = 260;
  const BACKOFF = [30, 60, 120, 240, 300];

  const norm = s => (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  /* ------------------------------------------------------------- Einlesen */

  const TITLE_KEYS = ['track name', 'trackname', 'track', 'title', 'titel', 'song', 'song title', 'song name', 'name', 'track title'];
  const ARTIST_KEYS = ['artist name(s)', 'artist name', 'artist names', 'artist', 'artists', 'artist(s)', 'kunstler', 'künstler', 'interpret', 'album artist', 'albumartist'];
  const ALBUM_KEYS = ['album name', 'album', 'collection', 'release'];

  /* Zeilenweiser CSV-Leser, der Anfuehrungszeichen und Zeilenumbrueche in
     Feldern aushaelt - Songtitel mit Komma sind haeufig genug. */
  function parseDelimited(text, sep) {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
        continue;
      }
      if (c === '"' && field === '') { quoted = true; continue; }
      if (c === sep) { row.push(field); field = ''; continue; }
      if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some(x => x.trim())) rows.push(row);
        row = [];
        continue;
      }
      field += c;
    }
    row.push(field);
    if (row.some(x => x.trim())) rows.push(row);
    return rows.map(r => r.map(x => x.trim()));
  }

  function guessSep(text) {
    const line = text.split(/\r?\n/).find(l => l.trim()) || '';
    const counts = { '\t': (line.match(/\t/g) || []).length,
                     ',': (line.match(/,/g) || []).length,
                     ';': (line.match(/;/g) || []).length };
    const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    return counts[best] > 0 ? best : null;
  }

  function findCol(head, keys) {
    for (let i = 0; i < head.length; i++) {
      const h = norm(head[i]).replace(/\s+/g, ' ');
      for (const k of keys) if (h === norm(k)) return i;
    }
    for (let i = 0; i < head.length; i++) {
      const h = norm(head[i]);
      for (const k of keys) if (h.startsWith(norm(k))) return i;
    }
    return -1;
  }

  /* Freitextzeile: "Titel - Künstler" oder "Künstler - Titel". Welche Haelfte
     was ist, laesst sich nicht entscheiden - deshalb wird beim Aufloesen
     gegen beide Reihenfolgen bewertet. */
  function splitLoose(line) {
    const m = line.split(/\s+[-–—|]\s+/);
    if (m.length >= 2) return { title: m[0].trim(), artist: m.slice(1).join(' ').trim(), loose: true };
    return { title: line.trim(), artist: '', loose: true };
  }

  function fromJSON(data) {
    let arr = data;
    if (!Array.isArray(arr)) arr = data.items || data.tracks || data.songs || (data.tracks && data.tracks.items) || [];
    if (!Array.isArray(arr) && data.tracks && Array.isArray(data.tracks.items)) arr = data.tracks.items;
    if (!Array.isArray(arr)) return [];
    return arr.map(o => {
      const t = (o && o.track) || o || {};
      const title = t.name || t.title || t.trackName || t.track || '';
      let artist = '';
      if (Array.isArray(t.artists)) artist = t.artists.map(a => (typeof a === 'string' ? a : a.name)).filter(Boolean).join(', ');
      else artist = t.artist || t.artistName || t.artists || t.creator || '';
      const album = (t.album && (t.album.name || t.album)) || t.albumName || t.collectionName || '';
      return { title: String(title || '').trim(), artist: String(artist || '').trim(), album: String(album || '').trim() };
    }).filter(x => x.title || x.artist);
  }

  /* Nimmt den Dateiinhalt und liefert eine Titelliste. */
  function parse(text) {
    const raw = (text || '').replace(/^\ufeff/, '').trim();
    if (!raw) return { tracks: [], note: 'Datei ist leer.' };

    if (raw[0] === '[' || raw[0] === '{') {
      try {
        const tracks = fromJSON(JSON.parse(raw));
        if (tracks.length) return { tracks: cap(tracks) };
      } catch (e) { /* dann eben als Text */ }
    }

    /* M3U: alles Interessante steht in den #EXTINF-Zeilen. */
    if (/^#EXTM3U/m.test(raw)) {
      const tracks = raw.split(/\r?\n/)
        .filter(l => /^#EXTINF/i.test(l))
        .map(l => splitLoose(l.replace(/^#EXTINF:[^,]*,/i, '').trim()))
        .filter(t => t.title);
      if (tracks.length) return { tracks: cap(tracks) };
    }

    const sep = guessSep(raw);
    if (sep) {
      const rows = parseDelimited(raw, sep);
      if (rows.length) {
        const head = rows[0];
        const ti = findCol(head, TITLE_KEYS), ai = findCol(head, ARTIST_KEYS);
        if (ti >= 0 || ai >= 0) {
          const li = findCol(head, ALBUM_KEYS);
          const tracks = rows.slice(1).map(r => ({
            title: ti >= 0 ? (r[ti] || '') : '',
            artist: ai >= 0 ? (r[ai] || '') : '',
            album: li >= 0 ? (r[li] || '') : '',
          })).filter(x => x.title || x.artist);
          if (tracks.length) return { tracks: cap(tracks) };
        }
        /* Kein erkennbarer Kopf: erste zwei Spalten nehmen, Reihenfolge offen. */
        if (head.length >= 2) {
          const tracks = rows.map(r => ({ title: r[0] || '', artist: r[1] || '', album: '', loose: true }))
            .filter(x => x.title || x.artist);
          if (tracks.length) return { tracks: cap(tracks), note: 'Keine Spaltenüberschriften gefunden – erste zwei Spalten benutzt.' };
        }
      }
    }

    const tracks = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(splitLoose);
    return { tracks: cap(tracks) };
  }

  function cap(tracks) {
    const seen = new Set(), out = [];
    for (const t of tracks) {
      const k = norm(t.title) + '|' + norm(t.artist);
      if (k === '|' || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
      if (out.length >= MAX_TRACKS) break;
    }
    return out;
  }

  /* ---------------------------------------------------------- Aufloesen */

  function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; } }
  function saveCache(c) {
    try {
      const keys = Object.keys(c);
      if (keys.length > CACHE_MAX) keys.slice(0, keys.length - CACHE_MAX).forEach(k => delete c[k]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) {}
  }

  /* Treffer bleiben im localStorage, Fehlschlaege nur bis zum Neuladen -
     sonst waere ein Titel, den Apple gerade mal nicht ausspuckt, fuer immer weg. */
  const misses = new Set();

  const termOf = t => [t.title, t.artist].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const keyOf = t => norm(termOf(t));

  function score(c, t) {
    const cn = norm(c.trackName), ca = norm(c.artistName);
    const tt = norm(t.title), ta = norm(t.artist);
    const pairs = t.loose && ta ? [[tt, ta], [ta, tt]] : [[tt, ta]];
    let best = 0;
    for (const [wantT, wantA] of pairs) {
      let s = 0;
      if (wantT) {
        if (cn === wantT) s += 5;
        else if (cn.startsWith(wantT) || wantT.startsWith(cn)) s += 3;
        else if (cn.includes(wantT) || wantT.includes(cn)) s += 2;
        else s -= 2;
      }
      if (wantA) {
        if (ca === wantA) s += 4;
        else if (ca.includes(wantA) || wantA.includes(ca)) s += 3;
        else s -= 2;
      }
      if (!wantA && wantT) {
        /* Nur ein Feld: Wortueberdeckung entscheidet. */
        const words = wantT.split(' ').filter(Boolean);
        const hay = cn + ' ' + ca;
        const hit = words.filter(w => hay.includes(w)).length;
        s += hit / Math.max(1, words.length) * 3;
      }
      if (s > best) best = s;
    }
    return best;
  }

  async function lookup(track, country) {
    const url = 'https://itunes.apple.com/search?media=music&entity=song&limit=8'
      + '&country=' + country + '&term=' + encodeURIComponent(termOf(track));
    const res = await fetch(url);
    if (res.status === 403 || res.status === 429) { const e = new Error('throttled'); e.throttled = true; throw e; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.results || []).filter(r => r.previewUrl);
  }

  function toSong(c) {
    return {
      t: c.trackName,
      a: c.artistName,
      al: c.collectionName || '',
      y: c.releaseDate ? +c.releaseDate.slice(0, 4) : 0,
      g: c.primaryGenreName || '',
      s: 0,
      p: c.previewUrl,
      c: c.artworkUrl100 || '',
      id: c.trackId,
      k: c.trackId,        /* Apples Track-ID: macht den Sammellink moeglich */
    };
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* Wartet die Drosselung ab und zaehlt dabei sichtbar herunter. */
  async function waitOut(secs, opts) {
    const until = Date.now() + secs * 1000;
    while (Date.now() < until) {
      if (opts.cancelled && opts.cancelled()) return false;
      if (opts.onWait) opts.onWait(Math.ceil((until - Date.now()) / 1000));
      await sleep(500);
    }
    return true;
  }

  /* Loest die Titelliste ueber die iTunes-Suche auf. Sequentiell mit Pause,
     weil Apple sonst mit 403 dichtmacht; passiert es doch, wird gewartet und
     an derselben Stelle weitergemacht. Alles, was einmal gefunden wurde,
     bleibt im localStorage - ein zweiter Lauf ueberspringt es sofort. */
  async function resolve(tracks, opts) {
    opts = opts || {};
    const cache = loadCache();
    const songs = [], missed = [];
    let done = 0, throttled = false, waits = 0;
    const stop = () => !!(opts.cancelled && opts.cancelled());

    for (const t of tracks) {
      if (stop()) break;
      const key = keyOf(t);
      let hit = cache[key];
      if (hit === undefined && misses.has(key)) hit = null;

      while (hit === undefined) {
        try {
          let cands = await lookup(t, 'DE');
          if (!cands.length) cands = await lookup(t, 'US');
          let best = null, bestScore = 0;
          for (const c of cands) {
            const s = score(c, t);
            if (s > bestScore) { bestScore = s; best = c; }
          }
          hit = bestScore >= 2.5 && best ? toSong(best) : null;
          if (hit) cache[key] = hit; else misses.add(key);
          waits = 0;
        } catch (e) {
          if (!e.throttled) { hit = null; break; }
          saveCache(cache);
          if (waits >= BACKOFF.length) { throttled = true; break; }
          if (!await waitOut(BACKOFF[waits++], opts)) break;
        }
        await sleep(PAUSE_MS);
      }
      if (throttled || stop()) break;

      if (hit) songs.push({ ...hit }); else missed.push(termOf(t));
      done++;
      if (opts.onProgress) opts.onProgress(done, tracks.length);
    }

    saveCache(cache);
    return { songs: dedupe(songs), missed, throttled, done, total: tracks.length };
  }

  function dedupe(songs) {
    const seen = new Set(), out = [];
    for (const s of songs) {
      const k = s.id || norm(s.t) + '|' + norm(s.a);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }

  /* -------------------------------------------------------- Speicherplatz */

  function store(pl) {
    try {
      if (pl) localStorage.setItem(STORE_KEY, JSON.stringify({ name: pl.name, songs: pl.songs, missed: pl.missed }));
      else localStorage.removeItem(STORE_KEY);
    } catch (e) {}
  }

  /* Die eingelesene Titelliste bleibt liegen, damit ein abgebrochener Lauf
     spaeter weitergehen kann - auch nach einem Neuladen der Seite. */
  function storeQueue(name, tracks) {
    try {
      if (tracks && tracks.length) localStorage.setItem(QUEUE_KEY, JSON.stringify({ name, tracks }));
      else localStorage.removeItem(QUEUE_KEY);
    } catch (e) {}
  }

  function restoreQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null');
      return q && q.tracks && q.tracks.length ? q : null;
    } catch (e) { return null; }
  }

  function restore() {
    try {
      const pl = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      return pl && pl.songs && pl.songs.length ? pl : null;
    } catch (e) { return null; }
  }

  return { parse, resolve, store, restore, storeQueue, restoreQueue, MAX_TRACKS };
})();
