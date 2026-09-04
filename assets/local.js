/* Eigene Musik vom Gerät.

   Nichts wird hochgeladen: der Browser darf die gewählten Dateien lesen, das
   reicht. `assets/tags.js` holt Titel und Künstler aus den Tags, gespielt
   wird aus derselben Web-Audio-Maschinerie wie sonst - nur eben aus einem
   ganzen Song statt aus einer 30-Sekunden-Preview.

   Zwei Wege hinein, weil nicht jeder Browser beide kann:

     1. `showDirectoryPicker()` (Chrome, Edge). Der Ordner lässt sich als
        Handle in IndexedDB legen und beim nächsten Besuch wieder öffnen -
        einmal auswählen, danach ist die Mediathek einfach da.
     2. `<input webkitdirectory>` und Ziehen-und-Ablegen (überall, auch
        Safari und Firefox). Nach dem Neuladen muss der Ordner erneut
        gewählt werden, das erlaubt der Browser nicht anders.

   Damit der zweite Weg nicht jedes Mal Minuten kostet, liegen die gelesenen
   Tags unter `songrate:localmeta`: erkannt wird eine Datei an Pfad, Größe und
   Änderungsdatum, dann muss sie nicht noch einmal aufgemacht werden. */

const Local = (() => {

  const MIN = 5;                 /* so viele braucht eine Runde */
  const MAX_FILES = 6000;        /* darüber wird das Einlesen unzumutbar */
  const META_KEY = 'songrate:localmeta';
  const DB_NAME = 'songraten';
  const STORE = 'handles';

  const supported = () => typeof window !== 'undefined' && !!window.showDirectoryPicker;

  const pathOf = f => f.webkitRelativePath || f.relPath || f.name || '';
  const keyOf = f => pathOf(f) + '|' + f.size + '|' + (f.lastModified || 0);

  /* ------------------------------------------------------ Tag-Gedaechtnis */

  function loadMeta() {
    try {
      const raw = JSON.parse(localStorage.getItem(META_KEY) || 'null');
      if (!raw || !Array.isArray(raw.tracks)) return null;
      const map = new Map();
      raw.tracks.forEach(t => map.set(t.q, t));
      return { name: raw.name || '', map };
    } catch (e) { return null; }
  }

  function saveMeta(name, songs) {
    try {
      const tracks = songs.map(s => ({
        q: s.q, t: s.t, a: s.a, al: s.al, y: s.y, g: s.g, dur: s.dur, pic: s.pic, path: s.path,
      }));
      localStorage.setItem(META_KEY, JSON.stringify({ name, at: Date.now(), tracks }));
    } catch (e) { /* voll oder gesperrt - dann eben beim naechsten Mal neu lesen */ }
  }

  function forget() {
    try { localStorage.removeItem(META_KEY); } catch (e) {}
  }

  /* Was zuletzt drin war - nur zum Anzeigen, ohne Dateien laesst sich damit
     nicht spielen. */
  function lastKnown() {
    const m = loadMeta();
    return m ? { name: m.name, count: m.map.size } : null;
  }

  /* ------------------------------------------------------------ Einlesen */

  async function scan(files, opts) {
    opts = opts || {};
    const bekannt = (loadMeta() || { map: new Map() }).map;
    const liste = [...files].filter(f => Tags.isPlayable(f)).slice(0, MAX_FILES);
    const songs = [];
    let gelesen = 0;

    for (const f of liste) {
      if (opts.stop && opts.stop()) break;
      const q = keyOf(f);
      const alt = bekannt.get(q);
      let meta;
      if (alt) {
        meta = { t: alt.t, a: alt.a, al: alt.al, y: alt.y, g: alt.g, dur: alt.dur, pic: alt.pic };
      } else {
        meta = await Tags.read(f);
        gelesen++;
      }
      songs.push({
        t: meta.t, a: meta.a, al: meta.al || '', y: meta.y || 0, g: meta.g || '',
        s: 0, dur: meta.dur || 0, pic: meta.pic || null,
        p: '',                      /* keine Preview-URL, gespielt wird die Datei */
        c: '',                      /* Cover kommt bei der Aufloesung aus der Datei */
        file: f, path: pathOf(f), q,
      });
      if (opts.onProgress && (songs.length % 25 === 0 || songs.length === liste.length)) {
        opts.onProgress(songs.length, liste.length);
      }
      /* Zwischendurch Luft lassen, sonst friert die Seite bei 2000 Dateien ein. */
      if (gelesen % 40 === 39) await new Promise(r => setTimeout(r, 0));
    }

    const name = opts.name || folderName(liste) || 'Eigene Musik';
    if (songs.length) saveMeta(name, songs);
    return { name, songs, skipped: [...files].length - liste.length };
  }

  /* Der oberste gemeinsame Ordner gibt den Namen. */
  function folderName(files) {
    for (const f of files) {
      const p = pathOf(f).split('/');
      if (p.length > 1) return p[0];
    }
    return '';
  }

  /* ------------------------------------- Ordner ueber die neue Schnittstelle */

  async function walk(dir, out, prefix, stop) {
    if (out.length >= MAX_FILES) return;
    for await (const handle of dir.values()) {
      if (stop && stop()) return;
      if (out.length >= MAX_FILES) return;
      const name = handle.name;
      if (name.startsWith('.')) continue;
      if (handle.kind === 'directory') {
        await walk(handle, out, prefix + name + '/', stop);
      } else if (Tags.AUDIO.test(name)) {
        const f = await handle.getFile();
        /* webkitRelativePath ist hier leer, also selbst mitfuehren. */
        try { Object.defineProperty(f, 'relPath', { value: prefix + name }); } catch (e) {}
        out.push(f);
      }
    }
  }

  async function pickDirectory() {
    const dir = await window.showDirectoryPicker({ id: 'songraten-musik', mode: 'read' });
    await putHandle(dir);
    return dir;
  }

  async function filesFromHandle(dir, stop) {
    const out = [];
    await walk(dir, out, dir.name ? dir.name + '/' : '', stop);
    return out;
  }

  /* -------------------------------------------- Ziehen und Ablegen */

  /* Ein abgelegter Ordner steckt in `webkitGetAsEntry`, nicht in `files`. */
  async function fromDrop(dt) {
    const items = [...(dt.items || [])];
    const entries = items.map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (!entries.some(e => e.isDirectory)) {
      return [...(dt.files || [])].filter(f => Tags.isPlayable(f));
    }
    const out = [];
    for (const e of entries) await readEntry(e, out, '');
    return out;
  }

  function readEntry(entry, out, prefix) {
    return new Promise(res => {
      if (out.length >= MAX_FILES) return res();
      if (entry.isFile) {
        entry.file(f => {
          if (Tags.isPlayable(f)) {
            try { Object.defineProperty(f, 'relPath', { value: prefix + f.name }); } catch (e) {}
            out.push(f);
          }
          res();
        }, res);
      } else if (entry.isDirectory) {
        const rd = entry.createReader();
        const alle = [];
        const weiter = () => rd.readEntries(async list => {
          if (!list.length) {
            for (const e of alle) await readEntry(e, out, prefix + entry.name + '/');
            return res();
          }
          alle.push(...list);
          weiter();
        }, res);
        weiter();
      } else res();
    });
  }

  /* ------------------------------------------------ Ordner merken (IndexedDB) */

  function idb() {
    return new Promise((res, rej) => {
      if (typeof indexedDB === 'undefined') return rej(new Error('kein IndexedDB'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }

  async function putHandle(handle) {
    try {
      const db = await idb();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(handle, 'dir');
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) {}
  }

  async function getHandle() {
    try {
      const db = await idb();
      return await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly');
        const rq = tx.objectStore(STORE).get('dir');
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
    } catch (e) { return null; }
  }

  async function dropHandle() {
    try {
      const db = await idb();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete('dir');
    } catch (e) {}
  }

  /* 'granted' laeuft sofort durch, 'prompt' braucht einen Klick. */
  async function permission(handle, ask) {
    if (!handle || !handle.queryPermission) return 'granted';
    const opts = { mode: 'read' };
    let st = await handle.queryPermission(opts);
    if (st === 'prompt' && ask) st = await handle.requestPermission(opts);
    return st;
  }

  return { MIN, MAX_FILES, supported, scan, pickDirectory, filesFromHandle, fromDrop,
           getHandle, putHandle, dropHandle, permission, lastKnown, forget, saveMeta, pathOf };
})();
