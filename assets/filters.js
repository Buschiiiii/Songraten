/* Songauswahl: Regeln, mit denen der Pool eingeschraenkt, erweitert oder
   beschnitten wird. Drei Modi, damit sich alles kombinieren laesst:

     nur   schraenkt ein   (mehrere gleicher Art wirken als ODER,
                            verschiedene Arten als UND)
     ohne  wirft raus
     dazu  holt zurueck - schlaegt beide anderen

   "Standardauswahl, aber nur die 2010er, ohne Hip-Hop, dazu Billie Eilish"
   ist damit genau: nur 2010er + ohne Hip-Hop/Rap + dazu Billie Eilish. */

const Filters = (() => {

  const MIN_POOL = 30;
  const DEFAULT = [{ mode: 'ohne', type: 'instrumental', value: '', text: 'Instrumental' }];

  const norm = s => (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  /* Die Kataloge kennzeichnen Instrumentals nicht, deshalb die Erkennung
     ueber Titel, Album und die Genres, die praktisch nie Gesang haben.
     Bewusst eng gehalten - lieber ein Instrumental zu viel im Spiel als ein
     gesungener Song weniger. */
  const INST_WORDS = /(instrumental|karaoke|backing track|no vocals|ohne gesang|\bscore\b)/i;
  const INST_GENRES = new Set(['instrumental', 'klassik', 'classical', 'klassische musik', 'new age', 'score', 'filmmusik']);

  const isInstrumental = s =>
    INST_WORDS.test(s.t || '') || INST_WORDS.test(s.al || '') || INST_GENRES.has(norm(s.g));

  const decadeOf = s => (s.y ? Math.floor(s.y / 10) * 10 : 0);

  function matches(s, r, db) {
    switch (r.type) {
      case 'instrumental': return isInstrumental(s);
      case 'genre': return norm(s.g) === r.value;
      case 'decade': return decadeOf(s) === +r.value;
      case 'artist': return norm(s.a) === r.value ||
        (s.ar || []).some(a => norm(db.artists[a]) === r.value);
      default: return false;
    }
  }

  function apply(songs, rules, db) {
    rules = rules || [];
    const add = rules.filter(r => r.mode === 'dazu');
    const cut = rules.filter(r => r.mode === 'ohne');
    const only = {};
    rules.filter(r => r.mode === 'nur').forEach(r => (only[r.type] = only[r.type] || []).push(r));

    return songs.filter(s => {
      if (add.some(r => matches(s, r, db))) return true;
      if (cut.some(r => matches(s, r, db))) return false;
      for (const t in only) if (!only[t].some(r => matches(s, r, db))) return false;
      return true;
    });
  }

  /* Auswahlmoeglichkeiten fuer die Eingabe, jeweils nur was auch vorkommt. */
  function options(type, db) {
    if (type === 'instrumental') return [];
    const out = new Map();
    if (type === 'genre') {
      db.songs.forEach(s => { if (s.g) out.set(norm(s.g), s.g); });
    } else if (type === 'decade') {
      db.songs.forEach(s => { const d = decadeOf(s); if (d) out.set(String(d), d + 'er'); });
    } else if (type === 'artist') {
      db.songs.forEach(s => {
        (s.ar || []).forEach(a => { const n = db.artists[a]; if (n) out.set(norm(n), n); });
        if (s.a) out.set(norm(s.a), s.a);
      });
    }
    return [...out].map(([value, text]) => ({ value, text }))
      .sort((a, b) => String(a.text).localeCompare(String(b.text), 'de', { numeric: true }));
  }

  /* Freitext -> Regelwert. Erst exakt, dann Anfang, dann enthalten. */
  function parse(type, text, db) {
    if (type === 'instrumental') return { value: '', text: 'Instrumental' };
    const n = norm(text);
    if (!n) return null;
    const opts = options(type, db);
    return opts.find(o => o.value === n)
      || opts.find(o => norm(o.text) === n)
      || opts.find(o => o.value.startsWith(n))
      || opts.find(o => o.value.includes(n))
      || null;
  }

  const label = r => r.mode + ' · ' + (r.text || r.value);

  const same = (a, b) => a.mode === b.mode && a.type === b.type && String(a.value) === String(b.value);

  return { apply, matches, options, parse, label, same, isInstrumental, decadeOf, DEFAULT, MIN_POOL };
})();
