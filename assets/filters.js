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
  /* Charts, Jahrzehnte und Genres: dazu nur, was man versteht. In Playlist,
     Kuenstler und eigener Musik hat man selbst gewaehlt - dort nicht. */
  const LANG_RULES = [{ mode: 'nur', type: 'lang', value: 'en', text: 'Englisch' },
                      { mode: 'nur', type: 'lang', value: 'de', text: 'Deutsch' },
                      { mode: 'nur', type: 'lang', value: 'dh', text: 'Bekannte Hits' }];
  const DEFAULT_CHARTS = [...DEFAULT, ...LANG_RULES];

  const norm = s => (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  /* Die Kataloge kennzeichnen Instrumentals nicht, deshalb die Erkennung
     ueber Titel, Album und die Genres, die praktisch nie Gesang haben.
     Bewusst eng gehalten - lieber ein Instrumental zu viel im Spiel als ein
     gesungener Song weniger. */
  /* Dazu die Schlaflied-Fassungen („Lullaby Versions of Bad Bunny"), die
     Apple unter Kindermusik fuehrt - ohne Gesang und als Raetsel sinnlos. */
  const INST_WORDS = /(instrumental|karaoke|backing track|no vocals|ohne gesang|\bscore\b|lullaby (versions?|renditions?|covers?|tribute)|lullabies for bab|\brendition\b|piano (versions?|covers?|renditions?))/i;
  const INST_GENRES = new Set(['instrumental', 'klassik', 'classical', 'klassische musik', 'new age', 'score', 'filmmusik', 'schlaflieder']);

  const isInstrumental = s =>
    INST_WORDS.test(s.t || '') || INST_WORDS.test(s.al || '') || INST_GENRES.has(norm(s.g));

  const decadeOf = s => (s.y ? Math.floor(s.y / 10) * 10 : 0);

  /* ------------------------------------------------------------ Sprache */

  /* Apple liefert keine Sprache. Gestreamt wird weltweit, deshalb stehen
     Bad Bunny, Arijit Singh und BTS unter den bekanntesten Songs - in
     Deutschland erkennt sie kaum jemand. Die Sprache wird deshalb geraten,
     aus drei Quellen, die sich gegenseitig korrigieren:
       1. der Titel: fremde Schrift, Sonderzeichen (ñ ¿ ã ç ä ß), typische
          kurze Woerter je Sprache - „the", „you", „don't" gegen „el",
          „que", „corazón";
       2. das Genre: Latin, Pop auf Spanisch, Mexiko, K-Pop, Bollywood …;
       3. der Kuenstler: was seine uebrigen Songs sind. „Viva La Vida"
          bleibt so Englisch (Coldplay), „Infeliz" wird Spanisch (Bad Bunny).
     Geprueft gegen die Songliste vom 4. Oktober: rund 740 spanische, 115
     indische, 60 koreanische Songs; Englisch/Deutsch-Verwechslungen sind
     egal, beide gelten als verstaendlich. */
  /* Fremdsprachig heisst nicht unbekannt: Despacito kennt hier jeder,
     „Pink Venom" auch, Bad Bunnys „Ojitos Lindos" kaum jemand (Besitzer,
     4. Oktober: „es sollen nur die Songs raus, die man in DE nicht kennt").
     Ein fremdsprachiger Song wird zu „Bekannte Hits" (`dh`), wenn
       - er in Deutschland genug gestreamt wurde: `de` aus tools/fetch_de.py,
         die Spotify-Wochencharts-Summe nur fuer Deutschland, ab DE_HIT;
       - oder er K-Pop mit mindestens KPOP_HIT weltweiten Streams ist (die
         erste Fassung dieser Regel, vor den deutschen Zahlen; DDU-DU DDU-DU
         liegt bei 890 Mio.);
       - oder er auf DE_CLASSICS steht: Hits aus der Zeit vor Spotify, fuer
         die es keine deutschen Streamzahlen gibt. */
  const KPOP_HIT = 7.5e8;
  /* Erster echter Lauf (4. Oktober): Despacito 101 Mio., Mi Gente, Con
     Calma, Loco Contigo 48, El Perdon 16, Dura 15, Bum Bum Tam Tam 10 -
     darunter Sin Pijama, Bebe, Te Bote (5) und alles, was hier nie lief. */
  const DE_HIT = 1e7;
  const DE_CLASSICS = [['macarena', 'los del rio'], ['la bamba', 'los lobos'], ['la bamba', 'ritchie valens'],
    ['livin la vida loca', 'ricky martin'], ['gasolina', 'daddy yankee'], ['danza kuduro', 'don omar'],
    ['danza kuduro', 'lucenzo'], ['vem dancar kuduro', 'lucenzo'], ['despacito', 'luis fonsi'],
    ['bailando', 'enrique iglesias'], ['lambada', 'kaoma'], ['dragostea din tei', 'o zone'],
    ['ai se eu te pego', 'michel telo'], ['gangnam style', 'psy'], ['alors on danse', 'stromae'],
    ['papaoutai', 'stromae'], ['vamos a la playa', 'righeira'], ['bamboleo', 'gipsy kings'],
    ['volare', 'gipsy kings'], ['nel blu dipinto di blu', 'domenico modugno'], ['bella ciao', 'el profesor'],
    ['la isla bonita', 'madonna'], ['mi gente', 'j balvin'], ['taki taki', 'dj snake'], ['calma', 'pedro capo']];
  const LANGS = [['en', 'Englisch'], ['de', 'Deutsch'], ['dh', 'Bekannte Hits (fremdsprachig)'], ['es', 'Spanisch'],
    ['pt', 'Portugiesisch'], ['fr', 'Französisch'], ['it', 'Italienisch'], ['ko', 'K-Pop'], ['hi', 'Indisch'], ['x', 'Andere']];
  const LANG_NAME = Object.fromEntries(LANGS);
  const KNOWN = ['en', 'de', 'dh'];
  const wl = t => new Set(t.split(/\s+/).filter(Boolean));
  const LW = {
    en: wl(`the you your you're youre i i'm im i'll ill i've my it it's its is are be of to and on in with we all love
      this that what how like don't dont can't cant won't wont girl boy baby night time heart do go get got one up down
      out for just know want need feel let so oh yeah way world life say tell never ever back wanna gonna she he they
      them her his our us when where who why if not but from into over about more there here now again little man woman
      people home light lights party take make come around right call stay rain fire last first good bad better best
      will can could would should was were been has have had let's lets nothing something everything every forever
      tonight hold dream dreams sweet young wild free alone together without still only lonely crazy summer kiss smile
      sky blue red black white stop run walk talk shake hands eyes body mind soul ghost star stars sun moon`),
    es: wl(`el la los las del que qué y mi mis tu tus te se lo le les un una unos unas con por para sin es eres soy yo
      sí pero como cómo cuando cuándo donde dónde más muy todo toda todos nada nadie nunca siempre otra otro vez amor
      corazón corazon noche vida baila bailando bailar quiero quieres ella ellos tú mí aquí ahora hoy mañana adiós
      hola gracias bonita bonito linda lindo mami papi dime dile mucho poca poco sola loco loca chica chico fuego
      cielo luna playa besos beso dame ven vamos mía mío tuyo tuya nuestro nuestra desde hasta entre bien mal cosa
      gente mundo perreo despacito gasolina canción cancion secreto calma ojitos ojos pa pal sabe sé está estás esta
      este eso esa ese mujer hombre hermosa cariño olvidar quédate volver vuelve vuelvas tiempo verano fiesta música
      musica`),
    pt: wl(`não nao você voce vem ao vivo eu meu minha seu sua pra pro do da dos das um uma coração saudade beijo festa
      então agora tudo só muito pode vai sou melhor sozinha`),
    fr: wl(`je moi toi pas c'est j'ai alors danse toujours jamais amour oui sans avec mon ton nous vous pour dans rien
      coeur cœur ne suis vie belle le les et une`),
    it: wl(`il che sono ti amo non per mio mia della nel sempre cuore bella ciao zitti buoni volare amore tutto`),
    de: wl(`der das und ich du nicht ein eine einen mein meine dich mich mir dir wir ist auf mit für zu im von sie nacht
      liebe herz immer alles kein keine wenn dann noch schon nur wie über unter durch heute morgen leben welt zeit
      mann frau hier sind bin hab habe geht geh komm kommt bis sein seine`),
  };
  const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;
  const INDIC = /[ऀ-෿]/;
  const OTHER_SCRIPT = /[Ͱ-ϿЀ-ӿ֐-ۿ฀-๿぀-ヿ一-鿿]/;
  /* Genre -> Sprache, deutsche und englische Store-Namen (Playlists kommen
     manchmal aus dem US-Store). Normalisiert wie norm(). */
  const LANG_GENRES = {
    'latin urban': 'es', 'urbano latino': 'es', 'pop auf spanisch': 'es', 'pop latino': 'es', 'latin pop': 'es',
    'latin': 'es', 'mexiko': 'es', 'regional mexican': 'es', 'musica mexicana': 'es', 'salsa und karibik': 'es',
    'salsa y tropical': 'es', 'musica tropical': 'es', 'alternative und latin rock': 'es', 'latin rap': 'es',
    'reggaeton': 'es', 'reggaeton y hip hop': 'es', 'balladen und boleros': 'es',
    'k pop': 'ko', 'bollywood': 'hi', 'tamilisch': 'hi', 'indische popmusik': 'hi', 'indian pop': 'hi', 'punjabi': 'hi',
    'sertanejo': 'pt', 'brasilianisch': 'pt', 'mpb': 'pt', 'funk carioca': 'pt',
    'j pop': 'x', 'anime': 'x', 'c pop': 'x', 'mandopop': 'x', 'cantopop': 'x',
    'franzosischer pop': 'fr', 'french pop': 'fr', 'chanson': 'fr', 'variete francaise': 'fr',
    'italienischer pop': 'it', 'italian pop': 'it', 'pop italiano': 'it',
    'schlager': 'de', 'deutschpop': 'de', 'deutsch pop': 'de', 'deutscher pop': 'de', 'deutschrap': 'de', 'german pop': 'de',
  };

  /* Klammerzusaetze wie „(From "Brahmastra")" oder „(feat. …)" sagen nichts
     ueber die Sprache des Songs - weg damit, ebenso „ - Remastered". */
  function titleCore(t) {
    return String(t || '')
      .replace(/\s*[([](?:feat|ft|with|from|prod|remaster|live|ao vivo|en vivo|clean|explicit|version|ver\.)[^)\]]*[)\]]/gi, '')
      .replace(/\s+-\s+.*$/, '');
  }

  /* Was der Titel allein sagt: [Sprache, Gewicht]. */
  function fromTitle(s) {
    const roh = titleCore(s.t);
    if (HANGUL.test(roh) || HANGUL.test(s.a || '')) return ['ko', 9];
    if (INDIC.test(roh) || INDIC.test(s.a || '')) return ['hi', 9];
    if (OTHER_SCRIPT.test(roh) || OTHER_SCRIPT.test(s.a || '')) return ['x', 9];
    const lt = roh.toLowerCase().replace(/[’‘]/g, "'");
    if (/bzrp music sessions/.test(lt)) return ['es', 3];
    const sc = { en: 0, es: 0, pt: 0, fr: 0, it: 0, de: 0 };
    (lt.match(/[a-zà-öø-ÿœ']+/g) || []).forEach(w => {
      for (const k in LW) if (LW[k].has(w)) sc[k] += 1;
    });
    if (/[ñ¿¡]/.test(lt)) sc.es += 2;
    if (/[ãõç]/.test(lt)) sc.pt += 2;
    if (/[äöß]/.test(lt)) sc.de += 2;
    if (/(^|[^g])ü/.test(lt)) sc.de += 1.5;
    if (/[èêàœ]/.test(lt)) sc.fr += 1;
    if (/[áéíóú]/.test(lt)) { sc.es += 1; sc.pt += 0.5; }
    if (/n't|'s\b|'m\b|'re\b|'ll\b|'ve\b|in'\b/.test(lt)) sc.en += 1.5;
    let best = null, c = 0;
    for (const k in sc) if (sc[k] > c) { best = k; c = sc[k]; }
    return [best, c];
  }

  const langGenre = s => LANG_GENRES[norm(s.g)] || null;
  const namesOf = (s, db) => {
    const ns = (s.ar || []).map(a => db && db.artists && db.artists[a]).filter(Boolean);
    return (ns.length ? ns : [s.a || '']).map(norm).filter(Boolean);
  };

  /* Je Bestand einmal: was die Songs eines Kuenstlers fuer Sprachen haben.
     Ein Titel ohne Hinweis und ohne fremdes Genre zaehlt halb als Englisch -
     so gewinnt bei Coldplay Englisch, bei Bad Bunny Spanisch. */
  const profCache = new WeakMap();
  const titleCache = new WeakMap();
  const title = s => { let r = titleCache.get(s); if (!r) titleCache.set(s, r = fromTitle(s)); return r; };
  function profile(db) {
    let p = profCache.get(db);
    if (p) return p;
    p = new Map();
    (db.songs || []).forEach(s => {
      const [L, c] = title(s), g = langGenre(s);
      const [lab, w] = L && c >= 1 ? [L, 1] : g ? [g, 1] : ['en', 0.5];
      namesOf(s, db).forEach(n => {
        let m = p.get(n);
        if (!m) p.set(n, m = {});
        m[lab] = (m[lab] || 0) + w;
      });
    });
    profCache.set(db, p);
    return p;
  }
  function artistLean(s, db) {
    const p = profile(db), tot = {};
    namesOf(s, db).forEach(n => {
      const m = p.get(n) || {};
      for (const k in m) tot[k] = (tot[k] || 0) + m[k];
    });
    let k = null, v = 0, n = 0;
    for (const x in tot) { n += tot[x]; if (tot[x] > v) { v = tot[x]; k = x; } }
    return { k, share: n ? v / n : 0, n };
  }

  const langCache = new WeakMap();
  function langOf(s, db) {
    if (!s) return 'en';
    let per = langCache.get(db || s);
    if (!per) langCache.set(db || s, per = new WeakMap());
    if (per.has(s)) return per.get(s);
    let r = guess(s, db || { songs: [s] });
    if (r !== 'en' && r !== 'de' && knownInDe(s, r)) r = 'dh';
    per.set(s, r);
    return r;
  }

  const plainTitle = t => norm(String(t || '').replace(/\s+-\s+.*$/, '').replace(/\s*[([][^)\]]*[)\]]/g, ''));
  function knownInDe(s, r) {
    if ((s.de || 0) >= DE_HIT) return true;
    if (r === 'ko' && (s.s || 0) >= KPOP_HIT) return true;
    const t = plainTitle(s.t), a = ` ${norm(s.a)} `;
    return DE_CLASSICS.some(([ct, ca]) => t === ct && a.includes(` ${ca} `));
  }

  function guess(s, db) {
    const [L, c] = title(s), g = langGenre(s);
    if (c >= 9) return L;
    if (L && L !== 'en' && c >= 3) return L;
    const a = artistLean(s, db);
    /* K-Pop-Titel sind fast immer englisch, gesungen wird meist koreanisch
       („FAKE LOVE", „Kill This Love") - der Titel beweist hier nichts. */
    if (g === 'ko') return 'ko';
    if (g) {
      /* Shakira: „Hips Don't Lie" steht unter Pop auf Spanisch. */
      if (L === 'en' && c >= 1 && (c >= 2 || !(a.k === g && a.share >= 0.6))) return 'en';
      if (L === 'de' && c >= 2) return 'de';
      return g;
    }
    if (L && L !== 'en' && c >= 1) {
      /* „Viva La Vida", „Señorita", „Te Amo": englisch singende Kuenstler. */
      if (a.k === 'en' && a.share >= 0.75 && a.n >= 3) return 'en';
      return L;
    }
    if (L === 'en') return 'en';
    /* Kein Hinweis im Titel: der Kuenstler entscheidet, aber nur bei klarer
       Mehrheit - Becky G und Enrique Iglesias singen auch Englisch. Bei
       koreanischen und indischen Kuenstlern ist die Lage eindeutiger. */
    const reicht = a.k === 'ko' || a.k === 'hi' ? 0.6 : 0.85;
    if (a.k && a.k !== 'en' && a.share >= reicht && a.n >= 2) return a.k;
    return 'en';
  }

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
      /* „K-Pop-Hits" (kurz am 4. Oktober) steckt jetzt in „Bekannte Hits". */
      if (r.type === 'lang' && r.value === 'kh') x = { ...r, value: 'dh', text: 'Bekannte Hits' };
      if (!out.some(o => o.type === x.type && String(o.value) === String(x.value))) out.push(x);
    });
    return out;
  }

  function matches(s, r, db) {
    switch (r.type) {
      case 'instrumental': return isInstrumental(s);
      case 'lang': return langOf(s, db) === r.value;
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
  const optCache = new WeakMap();
  function options(type, db) {
    if (type === 'instrumental') return [];
    /* Sprachen in fester Reihenfolge, nur die vorkommenden. */
    if (type === 'lang') {
      const cnt = counts('lang', db);
      return LANGS.filter(([v]) => cnt.get(v)).map(([value, text]) => ({ value, text }));
    }
    /* Wie counts(): die Liste wird bei jedem Neuzeichnen der Filter
       gebraucht, und 3000 Namen zu sortieren ist nichts fuer jeden Klick. */
    let per = optCache.get(db);
    if (!per) optCache.set(db, per = {});
    if (per[type]) return per[type];
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
    return (per[type] = [...out].map(([value, text]) => ({ value, text }))
      .sort((a, b) => String(a.text).localeCompare(String(b.text), 'de', { numeric: true })));
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
      else if (type === 'lang') bump(langOf(s, db));
    });
    return (per[type] = m);
  }

  /* Freitext -> Regelwert. Erst exakt, dann Anfang, dann enthalten. */
  function parse(type, text, db) {
    if (type === 'instrumental') return { value: '', text: 'Instrumental' };
    if (type === 'lang') {
      const n0 = norm(text);
      const hit = LANGS.find(([v, t]) => v === n0 || norm(t).startsWith(n0));
      return hit ? { value: hit[0], text: hit[1] } : null;
    }
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

  /* Ist die Sprachregel „nur Englisch und Deutsch" gesetzt? Fuer den Schalter. */
  const knownOnly = rules => KNOWN.every(v => (rules || []).some(r => r.type === 'lang' && r.mode === 'nur' && r.value === v))
    && !(rules || []).some(r => r.type === 'lang' && r.mode === 'nur' && !KNOWN.includes(r.value));

  return { apply, matches, options, counts, parse, label, same, migrate, langOf, knownOnly,
           isInstrumental, decadeOf, genreOf, DEFAULT, DEFAULT_CHARTS, LANG_RULES, LANG_NAME, KPOP_HIT, DE_HIT, MIN_POOL };
})();
