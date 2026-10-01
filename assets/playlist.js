/* Playlist-Modus: Datei einlesen, Titel gegen die iTunes-Suche aufloesen.
   Gespielt wird immer Apples Hoerprobe - Spotify gibt keine mehr heraus,
   YouTube nur im eigenen Player. Die Titelliste kommt aus einem Export
   (CSV/TSV/TXT/JSON) oder, mit eigener App, direkt von Spotify (spotify.js).

   Aufgeloest wird in drei Stufen, schnellste zuerst: was schon einmal
   gefunden wurde (Cache) und was in songs.json steht, geht ohne Anfrage;
   stehen mehrere Titel desselben Kuenstlers an, holt eine Anfrage dessen
   ganzen Katalog; erst der Rest geht einzeln an die Suche. */

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

  /* ------------------------------------------------------- Abgleich */

  /* Fassungszusaetze hinten am Titel: „- Remastered 2011", „(feat. X)",
     „[Live]". Spotify haengt sie mit Bindestrich an, Apple in Klammern - fuer
     den Abgleich zaehlt nur, was davor steht. Wiederholt, weil „Only Girl
     (In the World) [Extended Club]" zwei davon hat. */
  const TAIL = /\s+[-–—]\s+[^-–—]+$/;
  function base(titel) {
    let s = String(titel || '').replace(TAIL, '');
    for (let i = 0; i < 4; i++) {
      const kurz = s.replace(/\s*[([][^)\]]*[)\]]\s*$/, '');
      if (kurz === s) break;
      s = kurz;
    }
    return norm(s) || norm(titel);
  }

  /* Kuenstlerfeld in Namen: der ganze String und die Beteiligten einzeln.
     „Simon & Garfunkel" bleibt als Ganzes mit drin - zerlegt wuerde es sonst
     auf jeden Simon passen, so passt es auf sich selbst. */
  const SPLIT = /\s*(?:[,;&/]|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b|\bvs\.?)\s*/i;
  function names(a) {
    const out = [norm(a), ...String(a || '').split(SPLIT).map(norm)].filter(Boolean);
    return [...new Set(out)];
  }

  const wort = (heuhaufen, nadel) => ` ${heuhaufen} `.includes(` ${nadel} `);

  /* Passt einer der gesuchten Namen? Gleich oder als eigenes Wort im Namen
     des Kandidaten - „Dua Lipa" in „Dua Lipa & DaBaby". Umgekehrt nicht:
     sonst passte „Pink" auf jeden Song von Pink Floyd. */
  function fits(theirs, want) {
    const da = theirs.flatMap(names);
    return want.some(w => da.some(x => x === w || wort(x, w)));
  }

  /* Der genaue Treffer: gleicher Grundtitel, passender Kuenstler. Unter
     mehreren gewinnt der wortgleiche Titel, sonst der kuerzeste - „Song"
     vor „Song (Live)". Bei Freitext ist offen, welche Haelfte der Titel ist. */
  function pick(cands, t) {
    const pairs = t.loose && t.artist ? [[t.title, t.artist], [t.artist, t.title]] : [[t.title, t.artist]];
    let best = null, rank = -Infinity;
    for (const [titel, wer] of pairs) {
      const b = base(titel), voll = norm(titel), want = names(wer);
      if (!b || !want.length) continue;
      for (const c of cands) {
        if (!c.previewUrl || base(c.trackName) !== b) continue;
        if (!fits([c.artistName], want)) continue;
        const r = (norm(c.trackName) === voll ? 1000 : 0) - String(c.trackName).length;
        if (r > rank) { rank = r; best = c; }
      }
    }
    return best;
  }

  function score(c, t) {
    const cn = norm(c.trackName), ca = norm(c.artistName);
    const tt = norm(t.title), ta = norm(t.artist);
    const pairs = t.loose && ta ? [[tt, ta], [ta, tt]] : [[tt, ta]];
    let best = 0;
    for (const [wantT, wantA] of pairs) {
      let s = 0;
      if (wantT) {
        if (cn === wantT) s += 5;
        else if (base(c.trackName) === base(wantT)) s += 4;
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

  /* Apples Suche findet nur, was **jedes** Wort im Suchbegriff traegt. Ein
     Spotify-Export bringt aber „Sweet Dreams (Are Made of This) - 2005
     Remaster" von „Eurythmics;Annie Lennox;Dave Stewart" mit - drei Woerter
     zu viel, und Apple liefert nichts. Bei einer Testliste blieb so die
     Haelfte liegen. Gesucht wird deshalb in Stufen, jede lockerer als die
     davor, und bewertet wird erst danach:

       1. Grundtitel und erster Kuenstler      „Sweet Dreams Eurythmics"
       2. nur der Grundtitel, mehr Treffer      „Sweet Dreams"
       3. wie 1, im US-Store

     „JAŸ-Z", „Beyoncé" und typografische Apostrophe werden vorher
     geglaettet. Der Schluessel im Cache bleibt der volle Titel, sonst waeren
     alte Treffer verloren. */
  const glatt = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`´]/g, "'").replace(/[“”„]/g, '"').replace(/\s+/g, ' ').trim();
  /* Der erste Kuenstler. Steht ein Semikolon drin (Exportify, Spotify), ist
     das die Trennung und ein Komma Teil des Namens - „Earth, Wind & Fire;
     Someone". Sonst trennt auch das Komma. Wo Spotify die Namen einzeln
     liefert, steht der erste als `lead` schon am Titel. */
  const LEAD = /\s*(?:[,;]|\bfeat\.?|\bft\.|\bfeaturing\b|\bwith\b)\s*/i;
  const leadOf = a => {
    const s = String(a || '');
    return (s.includes(';') ? s.split(';')[0] : s.split(LEAD)[0]).trim();
  };
  const leadName = t => t.lead || leadOf(t.artist);
  function titleOf(titel) {
    let s = String(titel || '').replace(TAIL, '');
    for (let i = 0; i < 4; i++) {
      const kurz = s.replace(/\s*[([][^)\]]*[)\]]\s*$/, '');
      if (kurz === s || !kurz.trim()) break;
      s = kurz;
    }
    return glatt(s);
  }

  function queries(t) {
    if (t.loose) return ['DE', 'US'].map(country => ({ term: glatt(termOf(t)), country, limit: 15 }));
    const titel = titleOf(t.title), wer = glatt(leadName(t));
    const out = [];
    if (titel && wer) out.push({ term: titel + ' ' + wer, country: 'DE', limit: 15 });
    if (titel) out.push({ term: titel, country: 'DE', limit: 25 });
    if (titel && wer) out.push({ term: titel + ' ' + wer, country: 'US', limit: 15 });
    if (!out.length) out.push({ term: glatt(termOf(t)), country: 'DE', limit: 15 });
    return out;
  }

  async function lookup(q) {
    const url = 'https://itunes.apple.com/search?media=music&entity=song&limit=' + q.limit
      + '&country=' + q.country + '&term=' + encodeURIComponent(q.term);
    const res = await fetch(url);
    if (res.status === 403 || res.status === 429) { const e = new Error('throttled'); e.throttled = true; throw e; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return (data.results || []).filter(r => r.previewUrl);
  }

  /* Ein Titel, so lange, bis eine Stufe sicher trifft. Erst wenn keine
     trifft, entscheidet die alte Punktwertung ueber alles Gesammelte. */
  async function searchOne(t) {
    const alle = [];
    for (const q of queries(t)) {
      const cands = await lookup(q);
      const c = pick(cands, t);
      if (c) return c;
      alle.push(...cands);
      await sleep(PAUSE_MS);
    }
    let best = null, bestScore = 0;
    for (const c of alle) {
      const sc = score(c, t);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return bestScore >= 2.5 ? best : null;
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

  /* ------------------------------------ Einzeln nachlegen (Suche) */

  /* Eine Playlist muss nicht aus einer Datei kommen: „Loud Rihanna" in die
     Suche, Album anklicken, drin. Dieselbe iTunes-Suche wie oben, nur ohne
     Titelliste davor. */
  async function get(path, params) {
    const url = 'https://itunes.apple.com/' + path + '?' + new URLSearchParams(params);
    const res = await fetch(url);
    if (res.status === 403 || res.status === 429) { const e = new Error('throttled'); e.throttled = true; throw e; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()).results || [];
  }

  const toAlbum = c => ({
    id: c.collectionId,
    t: c.collectionName,
    a: c.artistName,
    y: c.releaseDate ? +c.releaseDate.slice(0, 4) : 0,
    g: c.primaryGenreName || '',
    c: c.artworkUrl100 || '',
    n: c.trackCount || 0,
  });

  /* `kind`: 'song' oder 'album'. */
  async function find(query, kind, country) {
    const q = String(query || '').trim();
    if (q.length < 2) return [];
    const alben = kind === 'album';
    const res = await get('search', { media: 'music', entity: alben ? 'album' : 'song',
                                      limit: 24, country: country || 'DE', term: q });
    return alben
      ? res.filter(r => r.collectionId && r.collectionName).map(toAlbum)
      : res.filter(r => r.previewUrl).map(toSong);
  }

  /* Alle Titel eines Albums. Ohne Preview taugt ein Titel nichts. */
  async function albumTracks(id, country) {
    const res = await get('lookup', { id, entity: 'song', limit: 200, country: country || 'DE' });
    return res.filter(r => r.wrapperType === 'track' && r.previewUrl).map(toSong);
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

  /* ------------------------------------------------------- Auftrag */

  /* Ein Import ist ein Auftrag: jeder Titel steht entweder unter `found`,
     unter `missed` oder noch in `pending`. Die Reihenfolge von `pending`
     darf sich waehrend des Laufs aendern - wer einen Titel vorzieht,
     schiebt ihn nach vorn, und der Lauf nimmt immer den ersten. Deshalb
     kein `for … of` ueber eine feste Liste. */
  function job(name, tracks) {
    const list = [];
    const seen = new Set();
    (tracks || []).forEach(t => {
      const x = { title: t.title || '', artist: t.artist || '', album: t.album || '', loose: !!t.loose };
      if (t.lead) x.lead = t.lead;
      x.key = keyOf(x);
      if (!x.key || seen.has(x.key)) return;
      seen.add(x.key);
      list.push(x);
    });
    return { name, tracks: list, pending: list.slice(), found: new Map(), missed: new Map(),
             tried: new Set(), current: null, extra: [] };
  }

  const take = (j, t) => { const i = j.pending.indexOf(t); if (i >= 0) j.pending.splice(i, 1); };
  const byKey = (j, key) => j.tracks.find(t => t.key === key);

  /* Treffer und Fehlschlag eintragen. `via` sagt, woher der Treffer kam -
     die Titelliste zeigt es an. */
  function mark(j, t, song, via) {
    take(j, t);
    if (song) {
      j.missed.delete(t.key);
      j.found.set(t.key, { song: { ...song, q: t.key }, via });
    } else {
      j.found.delete(t.key);
      j.missed.set(t.key, t);
    }
  }

  /* Was keine Anfrage kostet: schon einmal gefunden (Cache) oder in der
     eigenen Songliste (`local`, kommt aus songs.json). Laeuft vor dem
     ersten Netzzugriff, damit eine Liste voller bekannter Hits sofort
     spielbar ist. */
  function prefill(j, local, cache) {
    cache = cache || loadCache();
    let n = 0;
    for (const t of j.pending.slice()) {
      if (cache[t.key]) { mark(j, t, cache[t.key], 'cache'); n++; continue; }
      const s = local ? local(t) : null;
      if (s) { mark(j, t, s, 'local'); n++; }
    }
    return n;
  }

  /* Gehoeren mehrere offene Titel zum selben Kuenstler, holt eine Anfrage
     dessen Katalog (200 Songs) - das ersetzt bei einer Liste mit zehn
     Rihanna-Songs zehn Einzelsuchen. Nur bei sicherer Spaltenzuordnung:
     bei Freitext ist offen, welche Haelfte der Kuenstler ist. */
  const BATCH_MIN = 3;
  const leadKey = t => (t.loose ? '' : norm(leadName(t)));
  const catalogs = new Map();       /* nur fuer diese Sitzung */

  async function catalog(name) {
    const k = norm(name);
    if (catalogs.has(k)) return catalogs.get(k);
    const res = await get('search', { media: 'music', entity: 'song', attribute: 'artistTerm',
                                      limit: 200, country: 'DE', term: glatt(name) });
    const list = res.filter(r => r.previewUrl);
    catalogs.set(k, list);
    return list;
  }

  /* Der Lauf. Was gefunden wird, meldet `onFound` sofort - die Playlist
     waechst also mit und ist ab fuenf Songs spielbar, waehrend der Rest
     noch gesucht wird. Bremst Apple, wird gewartet und an derselben Stelle
     weitergemacht; der Fortschritt bleibt dabei stehen, statt von der
     Wartezeit verdraengt zu werden. */
  async function run(j, opts) {
    opts = opts || {};
    const cache = loadCache();
    const stop = () => !!(opts.cancelled && opts.cancelled());
    const tell = () => { if (opts.onProgress) opts.onProgress(j); };
    const hit = (t, song, via) => { mark(j, t, song, via); if (opts.onFound) opts.onFound(t); };

    if (prefill(j, opts.local, cache) && opts.onFound) opts.onFound(null);
    tell();

    let waits = 0, throttled = false;
    while (j.pending.length && !stop()) {
      const t = j.pending[0];
      if (misses.has(t.key)) { hit(t, null); continue; }
      j.current = t.key;
      tell();
      try {
        const wer = leadKey(t);
        const gruppe = wer && !j.tried.has(wer) ? j.pending.filter(x => leadKey(x) === wer) : [];
        if (gruppe.length >= BATCH_MIN) {
          let kat = [];
          try { kat = await catalog(leadName(t)); }
          catch (e) { if (e.throttled) throw e; }
          j.tried.add(wer);
          gruppe.forEach(x => {
            if (!j.pending.includes(x)) return;      /* inzwischen von Hand zugeordnet */
            const c = pick(kat, x);
            if (c) { const song = toSong(c); cache[x.key] = song; hit(x, song, 'artist'); }
          });
          waits = 0;
          await sleep(PAUSE_MS);
          continue;          /* der vorderste ist jetzt gefunden oder geht einzeln */
        }
        const c = await searchOne(t);
        /* Wer waehrend der Suche selbst zugeordnet hat, behaelt seine Wahl. */
        if (!j.pending.includes(t)) continue;
        if (c) { const song = toSong(c); cache[t.key] = song; hit(t, song, 'search'); }
        else { misses.add(t.key); hit(t, null); }
        waits = 0;
      } catch (e) {
        if (!e.throttled) { if (j.pending.includes(t)) hit(t, null); continue; }
        saveCache(cache);
        if (waits >= BACKOFF.length) { throttled = true; break; }
        if (!await waitOut(BACKOFF[waits++], opts)) break;
        continue;
      }
      await sleep(PAUSE_MS);
    }
    j.current = null;
    saveCache(cache);
    tell();
    return { throttled, complete: !j.pending.length };
  }

  /* Vorziehen: an die Spitze der Warteschlange. Mehrere behalten ihre
     Reihenfolge untereinander. */
  function prio(j, keys) {
    const want = new Set([].concat(keys));
    const vor = j.pending.filter(t => want.has(t.key));
    j.pending = [...vor, ...j.pending.filter(t => !want.has(t.key))];
    return vor.length;
  }

  /* Nicht Gefundenes noch einmal versuchen - ganz vorn. */
  function retry(j, keys) {
    const list = [].concat(keys).map(k => j.missed.get(k)).filter(Boolean);
    list.forEach(t => { j.missed.delete(t.key); misses.delete(t.key); });
    j.pending = [...list, ...j.pending.filter(t => !list.includes(t))];
    return list.length;
  }

  /* Von Hand zuordnen: der Treffer gilt fortan, auch im Cache. Mit `null`
     wird ein falscher Treffer wieder herausgenommen. */
  function assign(j, key, song) {
    const t = byKey(j, key);
    if (!t) return false;
    const cache = loadCache();
    if (song) cache[key] = { ...song, q: undefined };
    else delete cache[key];
    saveCache(cache);
    if (!song) misses.add(key);
    mark(j, t, song, 'manual');
    return true;
  }

  /* Die Suchanfrage, mit der man einen Titel selbst nachschlagen kann. */
  const hintOf = t => (t.loose ? glatt(termOf(t)) : [titleOf(t.title), glatt(leadName(t))].filter(Boolean).join(' '));

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

  /* Die Titelliste bleibt liegen - auch fertig, damit man nach einem
     Neuladen noch sieht, was fehlt, und es nachholen kann. Dazu, was nicht
     gefunden wurde, und ob die gespeicherte Playlist schon zu dieser Liste
     gehoert (`own`): eine alte bleibt stehen, bis die neue fuer eine Runde
     reicht. */
  function storeQueue(j) {
    try {
      if (j && j.tracks.length) {
        localStorage.setItem(QUEUE_KEY, JSON.stringify({
          name: j.name, own: !!j.own,
          tracks: j.tracks.map(t => ({ title: t.title, artist: t.artist, album: t.album,
                                       loose: t.loose || undefined, lead: t.lead })),
          missed: [...j.missed.keys()],
        }));
      } else localStorage.removeItem(QUEUE_KEY);
    } catch (e) {}
  }

  function restoreQueue() {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null');
      return q && q.tracks && q.tracks.length ? q : null;
    } catch (e) { return null; }
  }

  /* Nach dem Neuladen: Auftrag aus der gespeicherten Liste und der
     gespeicherten Playlist wieder zusammensetzen. Songs ohne `q` kamen von
     Hand dazu und bleiben als Zugabe dabei. Aeltere Speicherstaende kennen
     `own` nicht - dort gehoerte die Playlist immer zum letzten Lauf. */
  function revive(q, pl, local) {
    const j = job(q.name, q.tracks);
    j.own = q.own !== false;
    if (j.own && pl && pl.songs) {
      const index = new Map(j.tracks.map(t => [t.key, t]));
      pl.songs.forEach(s => {
        const t = s.q && index.get(s.q);
        if (t && j.pending.includes(t)) mark(j, t, s, 'stored');
        else if (!s.q) j.extra.push(s);
      });
    }
    prefill(j, local);
    (q.missed || []).forEach(k => {
      const t = j.pending.find(x => x.key === k);
      if (t) mark(j, t, null);
    });
    return j;
  }

  function restore() {
    try {
      const pl = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      return pl && pl.songs && pl.songs.length ? pl : null;
    } catch (e) { return null; }
  }

  return { parse, job, run, prefill, prio, retry, assign, hintOf, store, restore,
           storeQueue, restoreQueue, revive, find, albumTracks, dedupe, base, names, fits, keyOf,
           MAX_TRACKS };
})();
