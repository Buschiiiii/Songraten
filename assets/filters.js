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

  /* Apple vergibt fuer dieselbe Sache mehrere Genres - "Hip-Hop/Rap" (349
     Songs), "Hip-Hop" (14) und "Rap" (4) stehen nebeneinander. Wer Rap
     aussortieren will, musste bisher drei Haekchen setzen. Zusammengefasst
     wird nur, was wirklich dasselbe meint; "Latin Urban" und "Latin" bleiben
     getrennt. */
  const GENRE_ALIAS = {
    'hip hop': 'Hip-Hop/Rap',
    'rap': 'Hip-Hop/Rap',
    'zeitgenossischer r b': 'R&B/Soul',
    'house': 'Dance',
    'teen pop': 'Pop',
    'indie rock': 'Alternative',
    'weihnachten pop': 'Weihnachten',
    'musik zum fest': 'Weihnachten',
    'afro fusion': 'Afrobeats',
  };

  const genreOf = s => GENRE_ALIAS[norm(s.g)] || s.g || '';

  /* Regeln aus einer aelteren Fassung koennen auf ein Genre zeigen, das es so
     nicht mehr gibt ("ohne Hip-Hop"). Die werden auf den zusammengefassten
     Namen gezogen, statt wirkungslos herumzuliegen. */
  function migrate(rules) {
    const out = [];
    (rules || []).forEach(r => {
      let x = r;
      if (r.type === 'genre' && GENRE_ALIAS[r.value]) {
        const text = GENRE_ALIAS[r.value];
        x = { ...r, value: norm(text), text };
      }
      if (!out.some(o => o.type === x.type && String(o.value) === String(x.value))) out.push(x);
    });
    return out;
  }

  function matches(s, r, db) {
    switch (r.type) {
      case 'instrumental': return isInstrumental(s);
      case 'genre': return norm(genreOf(s)) === r.value;
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
      db.songs.forEach(s => { const g = genreOf(s); if (g) out.set(norm(g), g); });
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

  /* Wie viele Songs haengen an einem Wert - steht neben den Haekchen, damit
     man sieht, dass "nur Jazz" zwei Songs bedeutet. */
  const countCache = new WeakMap();
  function counts(type, db) {
    let per = countCache.get(db);
    if (!per) countCache.set(db, per = {});
    if (per[type]) return per[type];
    const m = new Map();
    const bump = k => { if (k) m.set(k, (m.get(k) || 0) + 1); };
    db.songs.forEach(s => {
      if (type === 'genre') bump(norm(genreOf(s)));
      else if (type === 'decade') bump(String(decadeOf(s)));
      else if (type === 'artist') {
        const ids = new Set((s.ar || []).map(a => norm(db.artists[a])));
        ids.add(norm(s.a));
        ids.forEach(bump);
      } else if (type === 'instrumental' && isInstrumental(s)) bump('');
    });
    return (per[type] = m);
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

  return { apply, matches, options, counts, parse, label, same, migrate,
           isInstrumental, decadeOf, genreOf, DEFAULT, MIN_POOL };
})();
