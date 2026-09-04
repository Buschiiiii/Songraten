/* Prueft assets/tags.js gegen selbstgebaute Dateien - MP3 (ID3v2.2/2.3/2.4
   und ID3v1), M4A, FLAC, Ogg, Opus und WAV. Binaerformate blind zu zerlegen
   geht sonst schief, ohne dass man es merkt: der Titel steht dann einfach
   nicht da, und der Dateiname springt ein.

   Laeuft ohne jsdom, nur mit Node:  node tools/test_tags.js  */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'tags.js'), 'utf8');
const Tags = eval(src + ';Tags');

let bad = 0;
const assert = (ok, msg) => { console.log((ok ? 'ok  ' : 'FEHLGESCHLAGEN: ') + msg); if (!ok) bad++; };

/* ------------------------------------------------------------ Bausteine */

const str = s => new Uint8Array([...s].map(c => c.charCodeAt(0) & 255));
const cat = (...parts) => {
  const list = parts.map(p => (p instanceof Uint8Array ? p : str(p)));
  const out = new Uint8Array(list.reduce((a, b) => a + b.length, 0));
  let p = 0;
  list.forEach(b => { out.set(b, p); p += b.length; });
  return out;
};
const be = (v, n) => { const o = new Uint8Array(n); for (let i = n - 1; i >= 0; i--) { o[i] = v & 255; v = Math.floor(v / 256); } return o; };
const le = (v, n) => { const o = new Uint8Array(n); for (let i = 0; i < n; i++) { o[i] = v & 255; v = Math.floor(v / 256); } return o; };
const synch = v => new Uint8Array([(v >> 21) & 127, (v >> 14) & 127, (v >> 7) & 127, v & 127]);
const utf8 = s => new TextEncoder().encode(s);

/* ---- MP3 mit ID3v2 ---- */
function id3v2Frame(id, text, ver) {
  const body = cat(new Uint8Array([3]), utf8(text));          /* 3 = UTF-8 */
  if (ver === 2) return cat(id.slice(0, 3), be(body.length, 3), body);
  const size = ver === 4 ? synch(body.length) : be(body.length, 4);
  return cat(id, size, new Uint8Array([0, 0]), body);
}
function apic(bild) {
  const body = cat(new Uint8Array([0]), 'image/jpeg', new Uint8Array([0]),
                   new Uint8Array([3]), 'Cover', new Uint8Array([0]), bild);
  return cat('APIC', be(body.length, 4), new Uint8Array([0, 0]), body);
}
function mp3(frames, ver) {
  const body = cat(...frames);
  return cat('ID3', new Uint8Array([ver, 0, 0]), synch(body.length), body,
             new Uint8Array(64));                              /* etwas "Audio" */
}
function id3v1(t, a, al, jahr, genre) {
  const feld = (s, n) => { const o = new Uint8Array(n); o.set(str(s).subarray(0, n)); return o; };
  return cat('TAG', feld(t, 30), feld(a, 30), feld(al, 30), feld(jahr, 4),
             new Uint8Array(30), new Uint8Array([genre]));
}

/* ---- M4A ---- */
const atom = (typ, ...inhalt) => { const b = cat(...inhalt); return cat(be(b.length + 8, 4), typ, b); };
const dataAtom = (text, kind) => atom('data', be(kind == null ? 1 : kind, 4), be(0, 4),
                                      typeof text === 'string' ? utf8(text) : text);
function m4a(bild) {
  const ilst = atom('ilst',
    atom('\xa9nam', dataAtom('M4A Titel')),
    atom('\xa9ART', dataAtom('M4A Kuenstler')),
    atom('\xa9alb', dataAtom('M4A Album')),
    atom('\xa9day', dataAtom('2007-05-02')),
    atom('\xa9gen', dataAtom('Electronic')),
    bild ? atom('covr', dataAtom(bild, 13)) : new Uint8Array(0));
  const mvhd = atom('mvhd', new Uint8Array([0, 0, 0, 0]), be(0, 4), be(0, 4), be(600, 4), be(600 * 214, 4));
  return cat(atom('ftyp', 'M4A ', be(0, 4)),
             atom('moov', mvhd, atom('udta', atom('meta', be(0, 4), ilst))));
}

/* ---- FLAC ---- */
function vorbisBlock(paare) {
  const zeilen = paare.map(p => { const b = utf8(p); return cat(le(b.length, 4), b); });
  return cat(le(4, 4), 'Test', le(zeilen.length, 4), ...zeilen);
}
function flac(paare, bild) {
  const info = new Uint8Array(34);
  /* 44100 Hz ab Bit 80, danach 3 Bit Kanaele, 5 Bit Tiefe, 36 Bit Samples */
  const rate = 44100;
  info[10] = (rate >> 12) & 255;
  info[11] = (rate >> 4) & 255;
  info[12] = ((rate & 15) << 4) | (1 << 1);
  const samples = 44100 * 250;
  info[13] = (info[13] & 0xf0) | ((samples / 4294967296) & 15);
  info.set(be(samples % 4294967296, 4), 14);
  const kom = vorbisBlock(paare);
  const teile = ['fLaC', new Uint8Array([0]), be(34, 3), info];
  if (bild) {
    const pb = cat(be(3, 4), be(10, 4), 'image/jpeg', be(5, 4), 'Cover',
                   be(0, 4), be(0, 4), be(0, 4), be(0, 4), be(bild.length, 4), bild);
    teile.push(new Uint8Array([4]), be(kom.length, 3), kom,
               new Uint8Array([0x86]), be(pb.length, 3), pb);
  } else {
    teile.push(new Uint8Array([0x84]), be(kom.length, 3), kom);
  }
  return cat(...teile);
}

/* ---- Ogg / Opus ---- */
function oggPage(nutz, seq) {
  const segs = [];
  let rest = nutz.length;
  while (rest >= 255) { segs.push(255); rest -= 255; }
  segs.push(rest);
  return cat('OggS', new Uint8Array([0, seq === 0 ? 2 : 0]), new Uint8Array(8),
             le(1, 4), le(seq, 4), new Uint8Array(4),
             new Uint8Array([segs.length]), new Uint8Array(segs), nutz);
}
const ogg = paare => cat(oggPage(cat(new Uint8Array([1]), 'vorbis', new Uint8Array(22)), 0),
                         oggPage(cat(new Uint8Array([3]), 'vorbis', vorbisBlock(paare)), 1));
const opus = paare => cat(oggPage(cat('OpusHead', new Uint8Array(11)), 0),
                          oggPage(cat('OpusTags', vorbisBlock(paare)), 1));

/* ---- WAV ---- */
function wav() {
  const info = cat('LIST', le(0, 4), 'INFO');           /* Laenge unten gesetzt */
  const felder = cat('INAM', le(10, 4), 'WAV Titel\0', 'IART', le(14, 4), 'WAV Kuenstler\0',
                     'IGNR', le(6, 4), 'Blues\0');
  const listBody = cat('INFO', felder);
  const list = cat('LIST', le(listBody.length, 4), listBody);
  const fmt = cat('fmt ', le(16, 4), le(1, 2), le(2, 2), le(44100, 4), le(176400, 4), le(4, 2), le(16, 2));
  const daten = cat('data', le(176400 * 3, 4), new Uint8Array(16));
  const body = cat('WAVE', fmt, list, daten);
  return cat('RIFF', le(body.length, 4), body);
}

const datei = (bytes, name) => new File([bytes], name);

/* Die Bausteine nutzt auch tools/test_ui.js, um Musikdateien zu bauen. */
module.exports = { mp3, id3v2Frame, id3v1, apic, m4a, flac, ogg, opus, wav, cat, str, be, le, synch };

/* ------------------------------------------------------------------ Tests */

if (require.main !== module) return;

(async () => {

  /* ---- ID3v2.3 ---- */
  let m = await Tags.read(datei(mp3([
    id3v2Frame('TIT2', 'Der Titel', 3),
    id3v2Frame('TPE1', 'Die Band', 3),
    id3v2Frame('TALB', 'Das Album', 3),
    id3v2Frame('TYER', '1994', 3),
    id3v2Frame('TCON', '(17)Rock', 3),
  ], 3), '01 irgendwas.mp3'));
  assert(m.t === 'Der Titel' && m.a === 'Die Band', 'ID3v2.3: Titel und Kuenstler');
  assert(m.al === 'Das Album' && m.y === 1994, 'ID3v2.3: Album und Jahr');
  assert(m.g === 'Rock', 'ID3v2.3: Genre aus der Nummer (' + m.g + ')');

  /* ---- ID3v2.4 (synchsafe Laengen) ---- */
  m = await Tags.read(datei(mp3([
    id3v2Frame('TIT2', 'Vierer', 4), id3v2Frame('TPE1', 'Band Vier', 4),
    id3v2Frame('TDRC', '2016-08-01', 4),
  ], 4), 'x.mp3'));
  assert(m.t === 'Vierer' && m.a === 'Band Vier' && m.y === 2016, 'ID3v2.4: Laengen synchsafe gelesen');

  /* ---- ID3v2.2 (drei Zeichen, drei Byte) ---- */
  m = await Tags.read(datei(mp3([
    id3v2Frame('TT2', 'Zweier', 2), id3v2Frame('TP1', 'Band Zwei', 2),
  ], 2), 'x.mp3'));
  assert(m.t === 'Zweier' && m.a === 'Band Zwei', 'ID3v2.2: die alten Kuerzel');

  /* ---- Umlaute in UTF-16 ---- */
  const utf16 = (s, bom) => {
    const b = [];
    if (bom) b.push(0xff, 0xfe);
    for (const c of s) { const v = c.charCodeAt(0); b.push(v & 255, v >> 8); }
    return new Uint8Array(b);
  };
  const frame16 = (id, s) => {
    const body = cat(new Uint8Array([1]), utf16(s, true));
    return cat(id, be(body.length, 4), new Uint8Array([0, 0]), body);
  };
  m = await Tags.read(datei(mp3([frame16('TIT2', 'Größenwahn'), frame16('TPE1', 'Ärzte')], 3), 'x.mp3'));
  assert(m.t === 'Größenwahn' && m.a === 'Ärzte', 'ID3v2: UTF-16 mit Umlauten (' + m.t + ')');

  /* ---- Titelbild ---- */
  const bild = new Uint8Array(300).fill(7);
  bild.set([0xff, 0xd8, 0xff], 0);
  const mitBild = datei(mp3([id3v2Frame('TIT2', 'Mit Bild', 3), apic(bild)], 3), 'x.mp3');
  m = await Tags.read(mitBild);
  assert(m.pic && m.pic.len === 300, 'ID3v2: das Titelbild wird gefunden (' + (m.pic && m.pic.len) + ')');
  const roh = new Uint8Array(await mitBild.slice(m.pic.off, m.pic.off + m.pic.len).arrayBuffer());
  assert(roh[0] === 0xff && roh[1] === 0xd8 && roh.length === 300,
    'ID3v2: die gemerkte Stelle trifft genau das Bild');

  /* ---- ID3v1 als Rueckfall ---- */
  m = await Tags.read(datei(cat(new Uint8Array(400), id3v1('Alter Titel', 'Alte Band', 'Alt', '1979', 17)), 'y.mp3'));
  assert(m.t === 'Alter Titel' && m.a === 'Alte Band' && m.y === 1979 && m.g === 'Rock',
    'ID3v1: wird gelesen, wenn kein v2 da ist');

  /* ---- M4A ---- */
  m = await Tags.read(datei(m4a(bild), 'z.m4a'));
  assert(m.t === 'M4A Titel' && m.a === 'M4A Kuenstler', 'M4A: Titel und Kuenstler aus den Atomen');
  assert(m.al === 'M4A Album' && m.y === 2007 && m.g === 'Electronic', 'M4A: Album, Jahr, Genre');
  assert(Math.round(m.dur) === 214, 'M4A: Spielzeit aus mvhd (' + Math.round(m.dur) + ' s)');
  assert(m.pic && m.pic.len === 300, 'M4A: Titelbild gefunden');
  const m4 = datei(m4a(bild), 'z.m4a');
  const rohM4 = new Uint8Array(await m4.slice(m.pic.off, m.pic.off + m.pic.len).arrayBuffer());
  assert(rohM4[0] === 0xff && rohM4[2] === 0xff, 'M4A: die Stelle des Bildes stimmt');

  /* ---- FLAC ---- */
  m = await Tags.read(datei(flac(['TITLE=Flac Titel', 'ARTIST=Flac Band', 'ALBUM=Flac Album',
                                  'DATE=2003-11-04', 'GENRE=Jazz']), 'a.flac'));
  assert(m.t === 'Flac Titel' && m.a === 'Flac Band', 'FLAC: Vorbis-Kommentare');
  assert(m.al === 'Flac Album' && m.y === 2003 && m.g === 'Jazz', 'FLAC: Album, Jahr, Genre');
  assert(Math.round(m.dur) === 250, 'FLAC: Spielzeit aus STREAMINFO (' + Math.round(m.dur) + ' s)');

  const fb = datei(flac(['TITLE=Mit Bild'], bild), 'b.flac');
  m = await Tags.read(fb);
  assert(m.pic && m.pic.len === 300, 'FLAC: Titelbild im PICTURE-Block');
  const rohF = new Uint8Array(await fb.slice(m.pic.off, m.pic.off + m.pic.len).arrayBuffer());
  assert(rohF[0] === 0xff && rohF[1] === 0xd8, 'FLAC: die Stelle des Bildes stimmt');

  /* ---- Ogg und Opus ---- */
  m = await Tags.read(datei(ogg(['TITLE=Ogg Titel', 'ARTIST=Ogg Band', 'DATE=1999']), 'c.ogg'));
  assert(m.t === 'Ogg Titel' && m.a === 'Ogg Band' && m.y === 1999, 'Ogg: Kommentare aus der zweiten Seite');

  m = await Tags.read(datei(opus(['TITLE=Opus Titel', 'ARTIST=Opus Band']), 'd.opus'));
  assert(m.t === 'Opus Titel' && m.a === 'Opus Band', 'Opus: OpusTags gelesen');

  /* ---- WAV ---- */
  m = await Tags.read(datei(wav(), 'e.wav'));
  assert(m.t === 'WAV Titel' && m.a === 'WAV Kuenstler' && m.g === 'Blues', 'WAV: INFO-Liste');
  assert(Math.round(m.dur) === 3, 'WAV: Spielzeit aus fmt und data (' + m.dur + ')');

  /* ---- Dateiname als letzte Rettung ---- */
  const ohne = datei(new Uint8Array(500), 'x.mp3');
  Object.defineProperty(ohne, 'webkitRelativePath', { value: 'Musik/Die Band/Das Album/03 - Der Titel.mp3' });
  m = await Tags.read(ohne);
  assert(m.t === 'Der Titel', 'Dateiname: Nummer und Trennstrich weg (' + m.t + ')');
  assert(m.al === 'Das Album' && m.a === 'Die Band', 'Dateiname: Album und Kuenstler aus dem Pfad');

  const nurTitel = datei(new Uint8Array(500), '07 Lonely Boy.flac');
  m = await Tags.read(nurTitel);
  assert(m.t === 'Lonely Boy' && !m.a, 'Dateiname: ohne Pfad bleibt der Kuenstler leer');

  m = await Tags.read(datei(new Uint8Array(500), '99 Luftballons.flac'));
  assert(m.t === '99 Luftballons', 'Dateiname: eine Zahl im Titel bleibt stehen (' + m.t + ')');
  m = await Tags.read(datei(new Uint8Array(500), '3. Africa.mp3'));
  assert(m.t === 'Africa', 'Dateiname: Nummer mit Punkt faellt weg (' + m.t + ')');

  const strich = datei(new Uint8Array(500), 'Adele - Hello.mp3');
  m = await Tags.read(strich);
  assert(m.t === 'Hello' && m.a === 'Adele', 'Dateiname: "Kuenstler - Titel" wird geteilt');

  /* ---- kaputte Datei bringt nichts zum Absturz ---- */
  const kaputt = cat('ID3', new Uint8Array([3, 0, 0]), synch(9999), new Uint8Array(20).fill(255));
  m = await Tags.read(datei(kaputt, 'Band - Titel.mp3'));
  assert(m.t === 'Titel' && m.a === 'Band', 'Kaputte Tags: der Dateiname springt ein');

  /* ---- welche Dateien ueberhaupt ---- */
  assert(Tags.isAudio(datei(new Uint8Array(1), 'a.flac')) && Tags.isAudio(datei(new Uint8Array(1), 'a.m4a'))
    && !Tags.isAudio(datei(new Uint8Array(1), 'cover.jpg')),
    'Auswahl: Musikdateien ja, Bilder nein');

  console.log(bad ? `\n${bad} Fehler` : '\nTags in Ordnung');
  process.exit(bad ? 1 : 0);
})();
