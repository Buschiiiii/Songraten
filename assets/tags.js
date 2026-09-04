/* Titel und Kuenstler aus einer lokalen Datei lesen.

   Ohne Server und ohne Bibliothek bleibt nur, die Tags selbst zu zerlegen -
   und das lohnt sich: der Dateiname allein ("01 Track.flac") taugt oft
   nichts. Gelesen werden ID3v2 und ID3v1 (MP3), die Atome von MP4/M4A
   (auch ALAC), Vorbis-Kommentare in FLAC, Ogg und Opus sowie die
   INFO-Liste in WAV. Reicht das alles nicht, wird der Pfad ausgewertet:
   "Kuenstler/Album/01 Titel.flac" sagt genug.

   Gelesen wird immer nur der Anfang der Datei ueber `slice()` - ein Album
   FLACs sind schnell mal zwei Gigabyte, und davon braucht es hier ein paar
   Kilobyte. Das Titelbild wird nicht mitgeschleppt, sondern nur seine Lage
   gemerkt und bei der Aufloesung nachgeladen. */

const Tags = (() => {

  const AUDIO = /\.(mp3|m4a|m4b|mp4|aac|flac|ogg|oga|opus|wav|wave|aiff|aif|aifc|wma|alac)$/i;
  /* Was der Browser sicher nicht dekodieren kann, gar nicht erst einlesen. */
  const PLAYABLE = /\.(mp3|m4a|m4b|mp4|aac|flac|ogg|oga|opus|wav|wave|aiff|aif|aifc)$/i;

  const isAudio = f => AUDIO.test(f.name || '') || /^audio\//.test(f.type || '');
  const isPlayable = f => PLAYABLE.test(f.name || '') || /^audio\//.test(f.type || '');

  const dec = (buf, enc) => new TextDecoder(enc || 'utf-8', { fatal: false }).decode(buf);
  const ascii = (u8, from, len) => String.fromCharCode(...u8.subarray(from, from + len));

  async function bytes(file, from, len) {
    const end = Math.min(file.size, from + len);
    if (end <= from) return new Uint8Array(0);
    return new Uint8Array(await file.slice(from, end).arrayBuffer());
  }

  const be = (u8, i, n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 256 + u8[i + k]; return v; };
  const le32 = (u8, i) => u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24) >>> 0;
  const synch = (u8, i) => ((u8[i] & 127) << 21) | ((u8[i + 1] & 127) << 14) | ((u8[i + 2] & 127) << 7) | (u8[i + 3] & 127);

  /* ------------------------------------------------------------- ID3v1 */

  const GENRES = ('Blues,Classic Rock,Country,Dance,Disco,Funk,Grunge,Hip-Hop,Jazz,Metal,New Age,Oldies,Other,Pop,R&B,Rap,'
    + 'Reggae,Rock,Techno,Industrial,Alternative,Ska,Death Metal,Pranks,Soundtrack,Euro-Techno,Ambient,Trip-Hop,Vocal,'
    + 'Jazz+Funk,Fusion,Trance,Classical,Instrumental,Acid,House,Game,Sound Clip,Gospel,Noise,Alternative Rock,Bass,Soul,'
    + 'Punk,Space,Meditative,Instrumental Pop,Instrumental Rock,Ethnic,Gothic,Darkwave,Techno-Industrial,Electronic,'
    + 'Pop-Folk,Eurodance,Dream,Southern Rock,Comedy,Cult,Gangsta,Top 40,Christian Rap,Pop/Funk,Jungle,Native American,'
    + 'Cabaret,New Wave,Psychedelic,Rave,Showtunes,Trailer,Lo-Fi,Tribal,Acid Punk,Acid Jazz,Polka,Retro,Musical,'
    + 'Rock & Roll,Hard Rock,Folk,Folk-Rock,National Folk,Swing,Fast Fusion,Bebob,Latin,Revival,Celtic,Bluegrass,'
    + 'Avantgarde,Gothic Rock,Progressive Rock,Psychedelic Rock,Symphonic Rock,Slow Rock,Big Band,Chorus,Easy Listening,'
    + 'Acoustic,Humour,Speech,Chanson,Opera,Chamber Music,Sonata,Symphony,Booty Bass,Primus,Porn Groove,Satire,'
    + 'Slow Jam,Club,Tango,Samba,Folklore,Ballad,Power Ballad,Rhythmic Soul,Freestyle,Duet,Punk Rock,Drum Solo,'
    + 'A capella,Euro-House,Dance Hall').split(',');

  const genreName = n => (n >= 0 && n < GENRES.length ? GENRES[n] : '');

  /* "(17)" oder "17" statt eines Namens - so schrieb ID3v2.3 das Genre. */
  function fixGenre(v) {
    if (!v) return '';
    const m = /^\(?(\d{1,3})\)?$/.exec(v.trim());
    if (m) return genreName(+m[1]) || '';
    return v.replace(/^\((\d{1,3})\)\s*/, (all, n) => '');
  }

  async function id3v1(file) {
    if (file.size < 128) return {};
    const u = await bytes(file, file.size - 128, 128);
    if (ascii(u, 0, 3) !== 'TAG') return {};
    const txt = (from, len) => dec(u.subarray(from, from + len), 'iso-8859-1').replace(/\0.*$/, '').trim();
    return {
      t: txt(3, 30), a: txt(33, 30), al: txt(63, 30),
      y: +txt(93, 4) || 0, g: u[127] < 255 ? genreName(u[127]) : '',
    };
  }

  /* ------------------------------------------------------------- ID3v2 */

  const ID3_TEXT = {
    TIT2: 't', TT2: 't', TPE1: 'a', TP1: 'a', TALB: 'al', TAL: 'al',
    TCON: 'g', TCO: 'g', TYER: 'y', TYE: 'y', TDRC: 'y', TDRL: 'y', TORY: 'y',
    TPE2: 'aa', TP2: 'aa',
  };

  function id3Text(u8) {
    if (!u8.length) return '';
    const enc = u8[0];
    const body = u8.subarray(1);
    let s;
    if (enc === 0) s = dec(body, 'iso-8859-1');
    else if (enc === 1) {
      /* Kodierung 1 traegt eine Byte-Reihenfolge-Marke vorweg; ohne sie
         entscheidet der Standard fuer LE. */
      const be16 = body[0] === 0xfe && body[1] === 0xff;
      s = dec(body, be16 ? 'utf-16be' : 'utf-16le');
    } else if (enc === 2) s = dec(body, 'utf-16be');
    else s = dec(body, 'utf-8');
    s = s.replace(/^\ufeff/, '');
    /* Mehrere Werte stehen durch \0 getrennt hintereinander. */
    return s.replace(/\0+$/, '').split('\0')[0].trim();
  }

  /* Die Unsynchronisation schiebt hinter jedes 0xFF eine 0x00 - vor dem
     Zerlegen wieder herausnehmen, sonst stimmen alle Laengen nicht. */
  function unsync(u8) {
    const out = new Uint8Array(u8.length);
    let n = 0;
    for (let i = 0; i < u8.length; i++) {
      out[n++] = u8[i];
      if (u8[i] === 0xff && u8[i + 1] === 0x00) i++;
    }
    return out.subarray(0, n);
  }

  async function id3v2(file, head) {
    const ver = head[3];
    const flags = head[5];
    const size = synch(head, 6);
    if (!size || size > 40e6) return {};
    let u = await bytes(file, 10, size);
    let base = 10;
    if (flags & 0x80) { u = unsync(u); base = -1; }   /* Lage verschiebt sich */

    let p = 0;
    if (flags & 0x40) {                               /* erweiterte Kopfdaten */
      p += ver >= 4 ? synch(u, 0) : be(u, 0, 4) + 4;
    }
    const out = {};
    const idLen = ver <= 2 ? 3 : 4;
    const sizeLen = ver <= 2 ? 3 : 4;
    while (p + idLen + sizeLen <= u.length) {
      const id = ascii(u, p, idLen);
      if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
      const len = ver >= 4 ? synch(u, p + idLen) : be(u, p + idLen, sizeLen);
      const headLen = idLen + sizeLen + (ver <= 2 ? 0 : 2);
      const from = p + headLen;
      if (len <= 0 || from + len > u.length) break;
      const key = ID3_TEXT[id];
      if (key) {
        const v = id3Text(u.subarray(from, from + len));
        if (v && !out[key]) out[key] = key === 'y' ? (+String(v).slice(0, 4) || 0) : v;
      } else if ((id === 'APIC' || id === 'PIC') && !out.pic && base >= 0) {
        out.pic = picFromApic(u, from, len, id === 'PIC', base);
      }
      p = from + len;
    }
    if (out.g) out.g = fixGenre(out.g);
    return out;
  }

  /* APIC: Kodierung, MIME, Bildtyp, Beschreibung, dann die Daten. Gemerkt
     wird nur, wo sie liegen. */
  function picFromApic(u, from, len, short, base) {
    let i = from + 1;
    let mime;
    if (short) { mime = 'image/' + ascii(u, i, 3).toLowerCase().replace('jpg', 'jpeg'); i += 3; }
    else {
      const start = i;
      while (i < from + len && u[i] !== 0) i++;
      mime = dec(u.subarray(start, i), 'iso-8859-1') || 'image/jpeg';
      i++;
    }
    i++;                                     /* Bildtyp */
    const enc = u[from];
    if (enc === 1 || enc === 2) { while (i + 1 < from + len && !(u[i] === 0 && u[i + 1] === 0)) i += 2; i += 2; }
    else { while (i < from + len && u[i] !== 0) i++; i++; }
    const off = base + i;
    const size = from + len - i;
    return size > 100 ? { off, len: size, type: mime } : null;
  }

  /* -------------------------------------------------------------- FLAC */

  function vorbis(u8, from, meta) {
    let p = from;
    const vlen = le32(u8, p); p += 4 + vlen;
    let count = le32(u8, p); p += 4;
    const MAP = { title: 't', artist: 'a', album: 'al', date: 'y', originaldate: 'y',
                  genre: 'g', albumartist: 'aa', tracknumber: 'nr' };
    while (count-- > 0 && p + 4 <= u8.length) {
      const len = le32(u8, p); p += 4;
      if (len < 0 || p + len > u8.length) break;
      const line = dec(u8.subarray(p, p + len), 'utf-8');
      p += len;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = MAP[line.slice(0, eq).toLowerCase()];
      const val = line.slice(eq + 1).trim();
      if (key && val && !meta[key]) meta[key] = key === 'y' ? (+val.slice(0, 4) || 0) : val;
    }
  }

  async function flac(file) {
    const meta = {};
    let head = await bytes(file, 0, 65536);
    let p = 4;
    for (let guard = 0; guard < 32; guard++) {
      if (p + 4 > head.length) break;
      const last = head[p] & 0x80, type = head[p] & 0x7f, len = be(head, p + 1, 3);
      const from = p + 4;
      if (type === 0 && from + 18 <= head.length) {              /* STREAMINFO */
        const rate = (head[from + 10] << 12) | (head[from + 11] << 4) | (head[from + 12] >> 4);
        const total = ((head[from + 13] & 0x0f) * 4294967296) + be(head, from + 14, 4);
        if (rate) meta.dur = total / rate;
      } else if (type === 4) {                                   /* Kommentare */
        const block = from + len <= head.length ? head : await bytes(file, from, len);
        vorbis(block, block === head ? from : 0, meta);
      } else if (type === 6 && !meta.pic) {                      /* Titelbild */
        const b = from + 32 <= head.length ? head.subarray(from) : await bytes(file, from, 4096);
        let i = 4;
        const mlen = be(b, i, 4); i += 4;
        const mime = dec(b.subarray(i, i + mlen), 'iso-8859-1'); i += mlen;
        const dlen = be(b, i, 4); i += 4 + dlen;
        i += 16;
        const plen = be(b, i, 4); i += 4;
        if (plen > 100) meta.pic = { off: from + i, len: plen, type: mime || 'image/jpeg' };
      }
      p = from + len;
      if (last) break;
      if (p > head.length - 4 && p < file.size) head = await bytes(file, 0, Math.min(file.size, p + 65536));
    }
    return meta;
  }

  /* --------------------------------------------------------- Ogg/Opus */

  async function ogg(file) {
    const u = await bytes(file, 0, 200000);
    const meta = {};
    let p = 0, payload = [];
    while (p + 27 <= u.length && ascii(u, p, 4) === 'OggS' && payload.length < 3) {
      const segs = u[p + 26];
      let len = 0;
      for (let i = 0; i < segs; i++) len += u[p + 27 + i];
      const from = p + 27 + segs;
      payload.push(u.subarray(from, from + len));
      p = from + len;
    }
    const all = payload.length ? concat(payload) : u;
    for (let i = 0; i + 8 < all.length && i < 40000; i++) {
      if (all[i] === 3 && ascii(all, i + 1, 6) === 'vorbis') { vorbis(all, i + 7, meta); break; }
      if (ascii(all, i, 8) === 'OpusTags') { vorbis(all, i + 8, meta); break; }
    }
    return meta;
  }

  function concat(parts) {
    const n = parts.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(n);
    let p = 0;
    parts.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }

  /* ----------------------------------------------------------- MP4/M4A */

  const MP4_KEYS = { '\xa9nam': 't', '\xa9ART': 'a', '\xa9alb': 'al', '\xa9day': 'y',
                     '\xa9gen': 'g', aART: 'aa' };

  /* Atome sind ineinander geschachtelt: moov > udta > meta > ilst > Werte.
     Gelesen wird nur der moov-Block, und der ist bei Musik klein. */
  async function mp4(file) {
    const meta = {};
    let p = 0;
    for (let guard = 0; guard < 24 && p < file.size; guard++) {
      const h = await bytes(file, p, 16);
      if (h.length < 8) break;
      let size = be(h, 0, 4);
      const type = ascii(h, 4, 4);
      let head = 8;
      if (size === 1) { size = be(h, 8, 8); head = 16; }
      if (size === 0) size = file.size - p;
      if (size < head) break;
      if (type === 'moov') {
        if (size > 30e6) break;
        const u = await bytes(file, p + head, size - head);
        walkMp4(u, 0, u.length, meta, p + head);
        break;
      }
      p += size;
    }
    return meta;
  }

  function walkMp4(u, from, to, meta, base) {
    let p = from;
    while (p + 8 <= to) {
      let size = be(u, p, 4);
      const type = ascii(u, p + 4, 4);
      let head = 8;
      if (size === 1) { size = be(u, p + 8, 8); head = 16; }
      if (size < head || p + size > to) return;
      const inner = p + head;
      if (type === 'udta' || type === 'ilst') walkMp4(u, inner, p + size, meta, base);
      else if (type === 'meta') walkMp4(u, inner + 4, p + size, meta, base);   /* Version davor */
      else if (type === 'mvhd') {
        const v = u[inner];
        const scale = v === 1 ? be(u, inner + 20, 4) : be(u, inner + 12, 4);
        const dur = v === 1 ? be(u, inner + 24, 8) : be(u, inner + 16, 4);
        if (scale) meta.dur = dur / scale;
      } else if (MP4_KEYS[type] || type === 'gnre' || type === 'covr') {
        readMp4Data(u, inner, p + size, type, meta, base);
      }
      p += size;
    }
  }

  function readMp4Data(u, from, to, type, meta, base) {
    let p = from;
    while (p + 16 <= to) {
      const size = be(u, p, 4);
      if (size < 16 || p + size > to) return;
      if (ascii(u, p + 4, 4) === 'data') {
        const val = p + 16;
        const len = size - 16;
        if (type === 'covr') {
          if (!meta.pic && len > 100) {
            const kind = be(u, p + 8, 4) === 13 ? 'image/jpeg' : 'image/png';
            meta.pic = { off: base + val, len, type: kind };
          }
        } else if (type === 'gnre') {
          if (!meta.g) meta.g = genreName(be(u, val, 2) - 1);
        } else {
          const key = MP4_KEYS[type];
          const s = dec(u.subarray(val, val + len), 'utf-8').trim();
          if (s && !meta[key]) meta[key] = key === 'y' ? (+s.slice(0, 4) || 0) : s;
        }
      }
      p += size;
    }
  }

  /* --------------------------------------------------------------- WAV */

  const WAV_KEYS = { INAM: 't', IART: 'a', IPRD: 'al', ICRD: 'y', IGNR: 'g' };

  async function wav(file) {
    const u = await bytes(file, 0, Math.min(file.size, 300000));
    const meta = {};
    let p = 12, rate = 0, bytesPerSec = 0;
    while (p + 8 <= u.length) {
      const id = ascii(u, p, 4);
      const size = le32(u, p + 4);
      const from = p + 8;
      if (size < 0 || from > u.length) break;
      if (id === 'fmt ' && from + 16 <= u.length) bytesPerSec = le32(u, from + 8);
      else if (id === 'data' && bytesPerSec) meta.dur = size / bytesPerSec;
      else if (id === 'LIST' && ascii(u, from, 4) === 'INFO') {
        let q = from + 4;
        while (q + 8 <= Math.min(u.length, from + size)) {
          const k = ascii(u, q, 4), n = le32(u, q + 4);
          const key = WAV_KEYS[k];
          if (key) {
            const s = dec(u.subarray(q + 8, q + 8 + n), 'utf-8').replace(/\0/g, '').trim();
            if (s && !meta[key]) meta[key] = key === 'y' ? (+s.slice(0, 4) || 0) : s;
          }
          q += 8 + n + (n & 1);
        }
      } else if (id === 'id3 ' || id === 'ID3 ') {
        meta.id3At = from;
      }
      p = from + size + (size & 1);
    }
    return meta;
  }

  /* -------------------------------------------------------- Dateiname */

  const CLEAN = /\.[a-z0-9]{2,5}$/i;

  /* "03 - Kuenstler - Titel.flac", "03. Titel.mp3", "Kuenstler - Titel.m4a".
     Der Pfad hilft, wo der Name nichts hergibt: Kuenstler/Album/Titel. */
  function fromName(file) {
    const path = (file.webkitRelativePath || file.relPath || file.name || '').split('/');
    const base = (path.pop() || '').replace(CLEAN, '').trim();
    /* Vorne steht meist die Titelnummer. Nur wegnehmen, wenn sie sich als
       solche zu erkennen gibt - fuehrende Null oder ein Trennzeichen. Sonst
       verliert "99 Luftballons" seinen Namen. */
    let s = base.replace(/^\s*(0\d{1,2}|\d{1,3}\s*[-._)])\s*[-._)]?\s*/, '').trim() || base;
    const out = { t: s || base, a: '', al: '' };
    const teile = s.split(/\s+[-–—]\s+/);
    if (teile.length >= 2) {
      out.a = teile[0].trim();
      out.t = teile.slice(1).join(' - ').trim();
    }
    if (path.length) out.al = out.al || path[path.length - 1];
    if (!out.a && path.length >= 2) out.a = path[path.length - 2];
    return out;
  }

  /* ------------------------------------------------------------- lesen */

  async function read(file) {
    let meta = {};
    try {
      const head = await bytes(file, 0, 12);
      if (head.length >= 4) {
        if (ascii(head, 0, 3) === 'ID3') meta = await id3v2(file, await bytes(file, 0, 10));
        else if (ascii(head, 0, 4) === 'fLaC') meta = await flac(file);
        else if (ascii(head, 0, 4) === 'OggS') meta = await ogg(file);
        else if (ascii(head, 4, 4) === 'ftyp') meta = await mp4(file);
        else if (ascii(head, 0, 4) === 'RIFF') {
          meta = await wav(file);
          if (meta.id3At != null && !meta.t) {
            const sub = file.slice(meta.id3At);
            const h = await bytes(sub, 0, 10);
            if (ascii(h, 0, 3) === 'ID3') {
              const inner = await id3v2(sub, h);
              /* Die Lage des Bildes waere relativ zum Teilstueck - lieber keins. */
              delete inner.pic;
              Object.assign(meta, inner);
            }
          }
        }
      }
      if (!meta.t || !meta.a) {
        const v1 = await id3v1(file);
        Object.keys(v1).forEach(k => { if (!meta[k] && v1[k]) meta[k] = v1[k]; });
      }
    } catch (e) { /* kaputte Tags sind kein Grund, die Datei wegzuwerfen */ }

    const name = fromName(file);
    const out = {
      t: (meta.t || name.t || '').trim(),
      a: (meta.a || meta.aa || name.a || '').trim(),
      al: (meta.al || name.al || '').trim(),
      y: +meta.y || 0,
      g: fixGenre(meta.g || ''),
      dur: meta.dur || 0,
      pic: meta.pic || null,
    };
    if (!out.t) out.t = (file.name || '').replace(CLEAN, '');
    return out;
  }

  /* Das Titelbild wird erst geholt, wenn es gebraucht wird - sonst laegen
     tausend Cover im Speicher. */
  async function cover(file, pic) {
    if (!file || !pic || !pic.len) return null;
    try {
      const blob = file.slice(pic.off, pic.off + pic.len, pic.type || 'image/jpeg');
      return URL.createObjectURL(blob);
    } catch (e) { return null; }
  }

  return { read, cover, fromName, isAudio, isPlayable, genreName, AUDIO };
})();
