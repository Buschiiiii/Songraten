/* Songraten – Spiellogik */

const STAGES = [0.01, 0.1, 0.5, 2, 8, 15];
const TIERS = [
  { id: 'easy',       label: 'Easy',       mult: 1.0 },
  { id: 'medium',     label: 'Medium',     mult: 1.2 },
  { id: 'hard',       label: 'Hard',       mult: 1.5 },
  { id: 'expert',     label: 'Expert',     mult: 1.8 },
  { id: 'impossible', label: 'Impossible', mult: 2.2 },
];
const POINTS = { 0.01: 1000, 0.1: 850, 0.5: 700, 2: 500, 8: 300, 15: 150 };
const RECENT_MAX = 60;
/* Fuenf gleichwertige Plaetze statt der Schwierigkeitsstufen - fuer die
   Playlist und fuer Jahrzehnte oder Genres, in denen zu wenige Songs fuer eine
   sinnvolle Stufenleiter stecken. */
const FLAT_SLOTS = [1, 2, 3, 4, 5].map(n => ({ id: 'pl' + n, label: 'Song ' + n, short: String(n), mult: 1.0 }));
/* Im Heimspiel heissen die Plaetze auch so - man soll sehen, worauf man sich
   eingelassen hat. */
const HIT_SLOTS = FLAT_SLOTS.map(t => ({ ...t, label: 'Hit ' + t.short, hit: true }));
const TIER_MIN = 5;       /* so viele Songs braucht jede Stufe mindestens */

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

let DB = null;            /* { artists:[], songs:[] } */
let PL = null;            /* aufgeloeste Playlist, gleiche Form wie DB */
let mode = 'charts';      /* 'charts' | 'decades' | 'genres' | 'artist' | 'playlist' */
let AR = null;            /* geladener Kuenstlerkatalog, Form wie DB */
let LO = null;            /* eigene Musik vom Geraet, Form wie DB */
let pickFiltered = [];    /* Songs des gewaehlten Jahrzehnts bzw. Genres */
let byTier = {};
let filtered = [];        /* alles, was nach den Filtern uebrig bleibt */
let chartFiltered = [];   /* davon die mit fester Stufe - nur die spielen die Charts */
let plFiltered = [];      /* dasselbe fuer die Playlist */
let loFiltered = [];      /* dasselbe fuer die eigene Musik */
let filterMode = 'nur';   /* Wirkung, die ein Klick in den Listen bekommt */

/* Jeder Modus hat seinen eigenen Regelsatz: eine importierte Playlist bringt
   andere Genres und Kuenstler mit als die Charts, und wer dort „nur 1960er"
   gesetzt hat, soll seine Playlist nicht leer vorfinden. */
const activeFilters = () => (mode === 'playlist' ? settings.plFilters
  : mode === 'local' ? settings.loFilters
  : mode === 'artist' ? settings.arFilters : settings.filters);
function setFilters(list) {
  if (mode === 'playlist') settings.plFilters = list;
  else if (mode === 'local') settings.loFilters = list;
  else if (mode === 'artist') settings.arFilters = list;
  else settings.filters = list;
  save('settings', settings);
}
let round = [];           /* 5 Songstaende */
let active = 0;
let settings = load('settings', {
  stages: [true, true, true, true, true, true], start: 'hook', volume: 0.8, mode: 'charts',
  filters: Filters.DEFAULT.map(r => ({ ...r })),
  plFilters: Filters.DEFAULT.map(r => ({ ...r })),
  decade: 2010,
  genre: 'pop',
  artist: null,           /* zuletzt gespielter Kuenstler (Apple-ID) */
  service: Links.DEFAULT, /* Lieblingsdienst zum Nachhoeren */
  svcAll: false,          /* alle Dienste in der Aufloesung zeigen */
  exact: true,            /* genaue Links statt Suchseiten (ueber song.link) */
  open: {},               /* welche Panels aufgeklappt sind */
  draw: 'tiers',          /* 'tiers' = nach Seltenheit, 'random' = fuenf zufaellige */
  blocked: [],            /* von Hand entfernte Songs, gilt in jedem Modus */
  arFilters: Filters.DEFAULT.map(r => ({ ...r })),
  loFilters: Filters.DEFAULT.map(r => ({ ...r })),
  hard: false,
  hits: false,            /* Heimspiel: nur die grossen Hits, in jedem Modus */
});
/* Zusammengefasste Genres: alte Regeln auf den neuen Namen ziehen. */
settings.filters = Filters.migrate(settings.filters);
settings.plFilters = Filters.migrate(settings.plFilters);
/* Ein gespeicherter Dienst, den es nicht mehr gibt, faellt zurueck. */
if (!Links.has(settings.service)) settings.service = Links.DEFAULT;
let stats = load('stats', { rounds: 0, solved: 0, played: 0, best: 0, streak: 0, bestStreak: 0, byTier: {} });
let recent = load('recent', []);
let pick = null;          /* aktuell im Suchfeld gewaehlter Song */
let sugAll = [];          /* alle Treffer der aktuellen Eingabe */
let sugItems = [];        /* davon schon gezeichnet */
let sugIdx = -1;
const SUG_PAGE = 12;      /* so viele kommen pro Nachladen dazu */

function load(k, d) { try { return { ...d, ...JSON.parse(localStorage.getItem('songrate:' + k) || '{}') }; } catch (e) { return d; } }
function loadArr(k) { try { return JSON.parse(localStorage.getItem('songrate:' + k) || '[]'); } catch (e) { return []; } }
function save(k, v) { try { localStorage.setItem('songrate:' + k, JSON.stringify(v)); } catch (e) {} }
/* Frueher standen hier die Nummern der Songs in songs.json. Die verschieben
   sich bei jedem Datenlauf: nach dem Update vom 13. September zeigten davon
   noch 26 von 4222 auf denselben Song. Die Liste sperrte also nicht die
   zuletzt gespielten, sondern sechzig zufaellige. Jetzt steht dort derselbe
   Schluessel wie in der Blockliste, und alte Zahlen fliegen raus. */
recent = loadArr('recent').filter(x => typeof x === 'string');

const norm = s => (s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const enabledStages = () => STAGES.filter((_, i) => settings.stages[i]);

/* ---------------------------------------------------- Entfernte Songs */

/* Ein Song, den man nicht mehr sehen will, soll in jedem Modus weg sein -
   auch in der Playlist und der eigenen Mediathek, wo er unter anderer Nummer
   steht. Der Schluessel ist deshalb Titel und Kuenstler, nicht Apples
   Track-ID: die waere genauer, wuerde aber nur im selben Pool treffen. */
const songKey = s => (s ? norm(s.t) + '|' + norm(s.a) : '');

let blockedKeys = new Set();
function readBlocked() {
  settings.blocked = (settings.blocked || []).filter(b => b && b.key);
  blockedKeys = new Set(settings.blocked.map(b => b.key));
}
const isBlocked = s => blockedKeys.has(songKey(s));
const unblocked = list => (blockedKeys.size ? list.filter(s => !isBlocked(s)) : list);

function blockSong(s) {
  const key = songKey(s);
  if (!key || blockedKeys.has(key)) return;
  settings.blocked.push({ key, t: s.t, a: s.a });
  save('settings', settings);
  readBlocked();
  applyFilters();
}

function unblockSong(key) {
  settings.blocked = settings.blocked.filter(b => b.key !== key);
  save('settings', settings);
  readBlocked();
  applyFilters();
}

function unblockAll() {
  settings.blocked = [];
  save('settings', settings);
  readBlocked();
  applyFilters();
}

/* ------------------------------------------- Abgleich mit songs.json */

/* Steht ein Song aus einer Playlist, einem Kuenstlerkatalog oder der eigenen
   Musik auch in songs.json? Dann kennt man seine Streams - das braucht das
   Heimspiel -, und ein Import muss ihn nicht erst bei Apple suchen.
   Verglichen wird der Grundtitel ohne Fassungszusatz („- 2005 Remaster",
   „(feat. X)") und der Kuenstler ueber die Namen einzeln. */
let dbIndex = null;
function dbFind(title, artist) {
  if (!dbIndex) {
    dbIndex = new Map();
    DB.songs.forEach(s => {
      const k = Playlist.base(s.t);
      if (!dbIndex.has(k)) dbIndex.set(k, []);
      dbIndex.get(k).push(s);
    });
  }
  const cands = dbIndex.get(Playlist.base(title));
  const want = Playlist.names(artist);
  if (!cands || !want.length) return null;
  const voll = norm(title);
  let best = null, rank = -Infinity;
  for (const s of cands) {
    if (!s.p || !Playlist.fits([s.a, ...s.ar.map(i => DB.artists[i])], want)) continue;
    const r = (norm(s.t) === voll ? 1e12 : 0) + (s.s || 0);
    if (r > rank) { rank = r; best = s; }
  }
  return best;
}

/* ---- Heimspiel ---- */

/* Fuer Erfolgserlebnisse: in jedem Modus nur das oberste Fuenftel nach
   Bekanntheit. Bekanntheit heisst Streams, wo es welche gibt - das sind die
   Songs, die man heute kennt -, sonst der Jahreschartplatz (`f`). Songs aus
   Playlist, Kuenstlerkatalog oder eigener Musik bekommen sie ueber songs.json;
   was dort fehlt, ist vermutlich nicht der grosse Hit und kommt hinten an -
   im Kuenstlermodus in Apples Reihenfolge, die grob nach Beliebtheit geht. */
const HIT_SHARE = 0.2;
const HIT_MIN = 10;       /* darunter waere jede Runde dieselbe */
const fameMemo = new Map();
let hitMemo = { src: null, mode: '', out: [] };

function fameOf(s) {
  let m = s;
  if (s.d === 'playlist' || s.d === 'local') {
    const k = songKey(s);
    if (!fameMemo.has(k)) fameMemo.set(k, dbFind(s.t, s.a));
    m = fameMemo.get(k);
    if (!m) return null;
  }
  if (m.s > 0) return 1000 + m.s / 1e7;
  /* In den Charts zaehlen nur Streams - ein Jahressieger von 1962 ist dort
     kein Heimspiel. */
  return mode === 'charts' || m.f == null ? null : m.f;
}

function hitPool(list) {
  if (hitMemo.src === list && hitMemo.mode === mode) return hitMemo.out;
  const known = [], rest = [];
  list.forEach(s => { const v = fameOf(s); if (v == null) rest.push(s); else known.push([v, s]); });
  known.sort((a, b) => b[0] - a[0]);
  const ranked = known.map(x => x[1]).concat(rest);
  const n = Math.min(ranked.length, Math.max(HIT_MIN, Math.ceil(known.length * HIT_SHARE)));
  hitMemo = { src: list, mode, out: ranked.slice(0, n) };
  return hitMemo.out;
}

/* Ist in der laufenden Runde schon etwas passiert? Solange nicht, verliert
   man nichts, wenn sie ersetzt wird. */
const roundUntouched = () => round.every(r => r.status === 'playing' && !r.guesses.length && r.stage === 0);

/* Breiten der sichtbaren Kaesten: ein Kasten je Stufe, alle gleich breit.

   Nach Sekunden zu teilen geht nicht - 0,01s waere 0,07 % breit und damit
   unsichtbar. Logarithmisch geteilt bekommt ausgerechnet der laengste
   Abschnitt den schmalsten Kasten: von 8 auf 15 Sekunden ist nicht einmal
   eine Verdopplung, waehrend 0,01 auf 0,1 ein Faktor zehn ist. Gleich breite
   Kaesten sagen, was die Leiste eigentlich zeigt: sechs Versuche, du bist
   beim vierten. Die Sekunden rechnet der laufende Balken ueber barStops()
   sauber auf die Kanten um.

   Eine abgeschaltete Stufe bekommt keinen eigenen Kasten - ihre Sekunden
   gehoeren zur naechsten aktiven Stufe, die sie ja mitspielt, und der Kasten
   wird entsprechend breiter. */
function segmentWidths() {
  const out = [];
  let carry = 0;
  STAGES.forEach((_, i) => {
    if (settings.stages[i]) { out.push(1 + carry); carry = 0; }
    else carry += 1;
  });
  return out;
}

/* Stuetzpunkte fuer den laufenden Balken: Sekunde -> Pixel. Auch die
   abgeschalteten Stufen bekommen einen Punkt, obwohl sie keinen eigenen
   Kasten haben - sonst kroche der Balken durch einen verschmolzenen Kasten,
   als waere darin nur eine Stufe. */
function barStops(segs) {
  const stops = [];
  let si = 0, carry = [];
  STAGES.forEach((t, i) => {
    if (!settings.stages[i]) { carry.push(t); return; }
    const seg = segs[si++];
    if (!seg) return;
    const x0 = seg.offsetLeft, span = seg.offsetWidth;
    const teile = carry.length + 1;
    carry.forEach((ct, k) => stops.push({ t: ct, x: x0 + span * (k + 1) / teile }));
    stops.push({ t, x: x0 + span });
    carry = [];
  });
  return stops;
}

const slots = () => (usesTiers() ? TIERS : settings.hits ? HIT_SLOTS : FLAT_SLOTS);
/* Vorschlaege im Suchfeld: aus der eigenen Liste, wo es eine gibt. */
const pool = () => (mode === 'playlist' && PL ? PL
  : mode === 'local' && LO ? LO
  : mode === 'artist' && AR ? AR : DB);

/* ---------------------------------------------------------------- Start */

async function boot() {
  readBlocked();
  const res = await fetch('data/songs.json');
  DB = await res.json();
  DB.songs.forEach((s, i) => {
    s.i = i;
    s.n = norm(s.t);
    s.ar = s.ar || [];        /* aeltere Datenlaeufe kannten das Feld nicht */
    s.na = s.ar.map(a => norm(DB.artists[a])).join(' ');
  });
  const gespeichert = Playlist.restore();
  PL = buildPlaylist(gespeichert);
  const liste = Playlist.restoreQueue();
  plJob = liste ? Playlist.revive(liste, gespeichert, localFind) : null;
  applyFilters();                       /* erst rechnen, dann den Modus waehlen */
  if (plPlayable() && settings.mode === 'playlist') mode = 'playlist';
  else if (PICKED.includes(settings.mode) && listFor(settings.mode).length) mode = settings.mode;
  applyFilters();                       /* im Jahrzehntmodus sind die Stufen andere */
  buildChrome();
  newRound();
  $('#boot').remove();
  $('#app').hidden = false;
  /* Laeuft nebenher: der gemerkte Musikordner braucht kein Warten. */
  restoreLocal().catch(() => {});
}

/* ------------------------------------------------------------- Oberflaeche */

function buildChrome() {
  renderSlots();

  const chips = $('#stageChips');
  STAGES.forEach((s, i) => {
    const c = el('button', 'chip', String(s).replace('.', ',') + 's');
    c.onclick = () => {
      const on = settings.stages.filter(Boolean).length;
      if (settings.stages[i] && on <= 2) return;
      const before = round.map(r => enabledStages()[r.stage]);
      settings.stages[i] = !settings.stages[i];
      save('settings', settings);
      renderChips();
      remapStages(before);
      render();
      focusSearch();
    };
    chips.appendChild(c);
  });
  renderChips();

  $('#startMode').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      settings.start = b.dataset.v;
      save('settings', settings);
      $('#startMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      renderPanelSums();
      round.forEach((r, i) => {
        if (r.status !== 'playing' || r.guesses.length || r.stage !== 0) return;
        /* Bei eigenen Dateien steckt die Stelle im Ausschnitt selbst - der
           muss also noch einmal aus der Datei geschnitten werden. */
        if (r.song && (r.song.file || r.song.full)) { r.buffer = null; preload(i); }
        else r.offset = newOffset();
      });
      focusSearch();
    };
    b.classList.toggle('on', b.dataset.v === settings.start);
  });

  /* Gestuft oder fuenf zufaellige. Wie bei den Filtern wird die laufende
     Runde nicht angefasst - sonst waere das Umschalten ein Aufgeben. */
  $('#drawMode').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      settings.draw = b.dataset.v;
      save('settings', settings);
      $('#drawMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      applyFilters();
      focusSearch();
    };
    b.classList.toggle('on', b.dataset.v === (settings.draw || 'tiers'));
  });

  /* Heimspiel: wie die Spielweise ab der naechsten Runde - „Alle neu
     wuerfeln" startet sie sofort. */
  const hits = $('#hitMode');
  hits.checked = !!settings.hits;
  hits.onchange = () => {
    settings.hits = hits.checked;
    save('settings', settings);
    applyFilters();
    renderPanelSums();
    focusSearch();
  };

  const vol = $('#volume');
  vol.value = Math.round(settings.volume * 100);
  Audio2.setVolume(settings.volume);
  vol.oninput = () => {
    settings.volume = vol.value / 100;
    Audio2.setVolume(settings.volume);
    save('settings', settings);
    renderPanelSums();
  };

  const hard = $('#hardMode');
  hard.checked = !!settings.hard;
  hard.onchange = () => {
    settings.hard = hard.checked;
    save('settings', settings);
    render();          /* die gesperrten Plaetze aendern sich sofort */
    focusSearch();
  };

  $('#playBtn').onclick = playCurrent;
  $('#rerollAll').onclick = () => newRound();
  $('#actionBtn').onclick = submit;
  $('#clearPick').onclick = clearPick;
  $('#revealNext').onclick = closeReveal;
  $('#revealArt').onclick = () => playFull(revealed);
  $('#summaryNext').onclick = () => { Audio2.stop(); $('#summary').hidden = true; newRound(); };

  const inp = $('#search');
  inp.oninput = () => { pick = null; $('#clearPick').hidden = true; setAction(); suggest(inp.value); };
  /* Der Cursor bleibt im Suchfeld, deshalb duerfen die Kuerzel keine
     Schriftzeichen sein - sonst tippt man S und ueberspringt statt zu suchen. */
  inp.onkeydown = e => {
    const open = sugItems.length && !$('#suggest').hidden;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (open) {
        e.preventDefault();
        moveSuggest(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        playCurrent();
      }
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !inp.value) {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) stepPick(dir);
      else switchTo((active + dir + slots().length) % slots().length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) { newRound(); return; }
      if (e.shiftKey) { clearPick(); submit(); return; }
      if (sugIdx >= 0 && sugItems[sugIdx]) choose(sugItems[sugIdx]);
      else submit();
      return;
    }
    if (e.key === 'Escape') hideSuggest();
  };

  document.addEventListener('keydown', e => {
    /* Die Songliste hat ein eigenes Suchfeld und eigene Knoepfe - dort darf
       kein Kuerzel des Spielfelds dazwischenfunken. */
    if (!$('#browse').hidden) {
      if (e.key === 'Escape') closeBrowse();
      return;
    }
    if (!$('#imp').hidden) {
      if (e.key === 'Escape') closeImport();
      return;
    }
    if (e.target.tagName === 'INPUT') return;
    if (!$('#reveal').hidden || !$('#summary').hidden) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (!$('#reveal').hidden ? $('#revealNext') : $('#summaryNext')).click(); }
      return;
    }
    /* Keine Buchstaben als Kuerzel: nach einem Klick auf einen Filter liegt
       der Fokus auf dem Knopf, und wer dann "Sia" tippt, haette mit dem s
       uebersprungen. */
    if (e.key === ' ') { e.preventDefault(); playCurrent(); }
    else if (/^[1-5]$/.test(e.key)) switchTo(+e.key - 1);
  });

  document.addEventListener('click', e => {
    /* Ein Klick auf einen Knopf, der sich dabei selbst aus dem DOM nimmt,
       ist kein Klick daneben - sonst schliesst „weitere" die Liste. */
    if (!e.target.isConnected) return;
    if (!e.target.closest('.guess-row')) hideSuggest();
  });

  buildPlaylistUI();
  buildPlFindUI();
  buildBrowseUI();
  buildImportUI();
  buildArtistUI();
  buildLocalUI();
  buildServerUI();
  buildSpotifyUI();
  buildServiceUI();
  buildFilterUI();
  renderStats();
  buildPanels();
}

/* Die Leiste links und die Reiter oben zeigen die Schwierigkeitsstufen oder,
   wo es keine gibt, fuenf gleichwertige Plaetze. Gezeichnet wird nach der
   laufenden Runde, nicht nach dem aktuellen Pool: sonst stuenden dort Plaetze,
   waehrend noch eine Runde mit Stufen laeuft, weil ein Filter den Pool
   zwischendurch unter die Schwelle gedrueckt hat. */
function renderSlots() {
  const list = $('#tierList'), tabs = $('#tabs');
  list.innerHTML = '';
  tabs.innerHTML = '';
  const shown = round.length ? round.map(r => r.tier) : slots();
  shown.forEach((t, i) => {
    const b = el('button', 'tier-item', t.label);
    b.style.setProperty('--tc', `var(--t-${t.id})`);
    b.appendChild(el('span', 'dot'));
    b.onclick = () => switchTo(i);
    list.appendChild(b);

    const tab = el('button', 'tab', t.short || t.label);
    tab.style.setProperty('--tc', `var(--t-${t.id})`);
    tab.onclick = () => switchTo(i);
    tabs.appendChild(tab);
  });
}

/* Stufen umschalten darf die Runde nicht zuruecksetzen: die Position wird
   auf die naechste Stufe umgerechnet, die mindestens so lang ist wie bisher. */
function remapStages(before) {
  const st = enabledStages();
  const maxOff = Math.max(0, 30 - st[st.length - 1] - 0.5);
  round.forEach((r, i) => {
    if (r.status !== 'playing') return;
    let idx = st.findIndex(s => s >= before[i]);
    r.stage = idx < 0 ? st.length - 1 : idx;
    r.offset = Math.min(r.offset, maxOff);
  });
}

function newOffset() {
  /* Lokale Dateien bringen ihren Anfang selbst mit: dort wird schon beim
     Dekodieren an der richtigen Stelle geschnitten. */
  if (mode === 'local') return 0;
  const st = enabledStages();
  const maxOff = Math.max(0, 30 - st[st.length - 1] - 0.5);
  return settings.start === 'random' ? Math.random() * maxOff : 0;
}

function focusSearch() {
  const inp = $('#search');
  if (!inp.disabled) setTimeout(() => inp.focus(), 0);
}

function renderChips() {
  $('#stageChips').querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', settings.stages[i]));
  renderPanelSums();
}

/* ----------------------------------------------------------------- Runde */

/* Ist eine Stufe durch die Filter leer, wird aus dem restlichen Pool
   gezogen - lieber eine spielbare Runde als eine leere Kachel. Die Warnung
   in der Songauswahl sagt vorher, dass das passiert. */
function drawSong(tier, used) {
  let pool = (byTier[tier] || []).filter(s => !used.has(s.i));
  if (!pool.length) pool = activePool().filter(s => !used.has(s.i));
  if (!pool.length) return null;
  const fresh = pool.filter(s => !recent.includes(songKey(s)));
  const arr = fresh.length > 20 ? fresh : pool;
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffled(list) {
  const src = list.slice();
  for (let i = src.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [src[i], src[j]] = [src[j], src[i]];
  }
  return src;
}

function newRound() {
  Audio2.stop();
  clearTimeout(sweepTimer);
  cancelAnimationFrame(sweepRaf);
  /* Ohne Stufen: gemischt, zuletzt Gespieltes nach hinten - gerade im
     Heimspiel ist der Pool klein genug, dass es sonst auffaellt. */
  let picked = null;
  if (!usesTiers()) {
    const zuletzt = new Set(recent), frisch = [], alt = [];
    shuffled(activePool()).forEach(x => (zuletzt.has(songKey(x)) ? alt : frisch).push(x));
    picked = [...frisch, ...alt];
  }
  const used = new Set();
  round = slots().map((t, idx) => {
    const song = picked ? (picked[idx] || null) : drawSong(t.id, used);
    if (song) used.add(song.i);
    return {
      tier: t,
      song,
      offset: newOffset(),
      stage: 0,
      guesses: [],
      status: 'playing',
      points: 0,
      buffer: null,
      error: false,
    };
  });
  if (mode !== 'playlist' && mode !== 'local') {
    recent = [...round.map(r => r.song && songKey(r.song)).filter(Boolean), ...recent].slice(0, RECENT_MAX);
    save('recent', recent);
  }
  active = 0;
  renderSlots();
  render();
  resetBar();
  focusSearch();
  /* Lokale Dateien werden ganz dekodiert, bevor der Ausschnitt herausfaellt.
     Fuenf davon gleichzeitig sprengen den Speicher, also nacheinander. */
  if (mode === 'local') {
    const meins = ++roundToken;
    (async () => { for (let i = 0; i < round.length; i++) { if (meins !== roundToken) return; await preload(i); } })();
  } else round.forEach((r, i) => preload(i));
}

let roundToken = 0;

async function preload(i) {
  const r = round[i];
  if (!r.song || r.buffer) return;
  try {
    if (r.song.file || r.song.full) {
      /* Aus der Datei wird gleich beim Dekodieren der gebrauchte Ausschnitt
         geschnitten - der ganze Song bliebe sonst im Speicher liegen. */
      /* Immer nach der laengsten Stufe schneiden, nicht nach der gerade
         eingeschalteten - sonst fehlt Ton, wenn mitten in der Runde eine
         laengere Stufe dazukommt. */
      const laenge = STAGES[STAGES.length - 1] + 8;
      const cut = await Audio2.loadFile(r.song.file || r.song.full,
        { start: settings.start, seconds: laenge });
      r.buffer = cut.buffer;
      r.at = cut.start;
      r.offset = 0;
      if (!r.song.dur && cut.duration) r.song.dur = cut.duration;
    } else r.buffer = await Audio2.load(r.song.p);
  } catch (e) {
    /* Apple nimmt Previews gelegentlich offline, und nicht jeder Browser
       dekodiert jedes Format. Statt eine tote Kachel stehen zu lassen, wird
       einmal ein anderer Song gezogen. */
    if (!r.swapped && r.status === 'playing' && !r.guesses.length) {
      r.swapped = true;
      const used = new Set(round.map(x => x.song && x.song.i).filter(x => x != null));
      const next = usesTiers() ? drawSong(r.tier.id, used)
        : shuffled(activePool()).find(x => !used.has(x.i));
      if (next) {
        r.song = next;
        return preload(i);
      }
    }
    r.error = true;
  }
  if (i === active) render();
}

/* Im Hardmode wird der Reihe nach gespielt: einen Platz weiter vorne kann man
   nur betreten, wenn alle davor durch sind. */
const locked = i => settings.hard && round.slice(0, i).some(r => r.status === 'playing');

function switchTo(i) {
  if (i === active || locked(i)) return;
  Audio2.stop();
  resetBar();
  active = i;
  pick = null;
  $('#search').value = '';
  $('#clearPick').hidden = true;
  hideSuggest();
  render();
  focusSearch();
}

/* -------------------------------------------------------------- Abspielen */

async function playCurrent() {
  const r = round[active];
  if (!r || !r.song || r.status !== 'playing') return;
  const btn = $('#playBtn');
  /* Muss vor jedem await passieren: iOS gibt den Ton nur frei, solange die
     Nutzergeste noch laeuft. Nach dem Warten aufs Laden ist es zu spaet. */
  Audio2.unlock();
  if (!r.buffer) {
    btn.classList.add('loading');
    await preload(active);
    btn.classList.remove('loading');
    if (!r.buffer) return;
  }
  const secs = enabledStages()[r.stage];
  btn.classList.add('playing');
  const dur = Audio2.play(r.buffer, r.offset, secs, () => btn.classList.remove('playing'));
  sweepBar(secs);
  if (dur < 0.25) setTimeout(() => btn.classList.remove('playing'), 260);
}

/* Zeigt in der Leiste mit, wie weit der Ausschnitt laeuft: der helle Balken
   waechst von der Null bis ans Ende des aktuellen Abschnitts.

   Die Leiste ist logarithmisch geteilt, die Zeit laeuft aber gleichmaessig -
   ein linear wachsender Balken haengt deshalb fast die ganze Zeit zu weit
   links, weil er sich durch die kurzen Abschnitte quaelt. Darum wird jede
   gehoerte Sekunde einzeln auf die Leiste umgerechnet: nach 0,01s steht der
   Balken genau am Ende des 0,01s-Abschnitts, nach 2s am Ende des 2s-
   Abschnitts. Sehr kurze Stufen laufen optisch ueber 0,4s ab, sonst saehe man
   sie gar nicht - die Breite bleibt korrekt, nur das Tempo ist gestreckt. */
let sweepTimer = null;
let sweepRaf = null;

/* Sekunden -> Pixel, innerhalb eines Abschnitts linear interpoliert. */
function xForTime(t, stops) {
  let prevT = 0, prevX = 0;
  for (const s of stops) {
    if (t <= s.t) return prevX + (s.t > prevT ? (t - prevT) / (s.t - prevT) * (s.x - prevX) : 0);
    prevT = s.t; prevX = s.x;
  }
  return stops.length ? stops[stops.length - 1].x : 0;
}

function sweepBar(secs) {
  const bar = $('#stageBar');
  const ov = bar.querySelector('.stage-progress');
  const segs = [...bar.querySelectorAll('.stage-seg')];
  if (!ov || segs.length !== enabledStages().length) return;

  const stops = barStops(segs);
  const dur = Math.max(secs, 0.4) * 1000;
  const t0 = performance.now();

  clearTimeout(sweepTimer);
  cancelAnimationFrame(sweepRaf);
  ov.style.transition = 'none';
  ov.style.width = '0px';
  ov.style.opacity = '1';

  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    ov.style.width = xForTime(p * secs, stops) + 'px';
    if (p < 1) sweepRaf = requestAnimationFrame(step);
    else sweepTimer = setTimeout(() => {
      ov.style.transition = 'opacity .45s ease';
      ov.style.opacity = '0';
    }, 260);
  };
  sweepRaf = requestAnimationFrame(step);
}

function resetBar() {
  clearTimeout(sweepTimer);
  cancelAnimationFrame(sweepRaf);
  const ov = $('#stageBar').querySelector('.stage-progress');
  if (ov) { ov.style.transition = 'none'; ov.style.width = '0px'; ov.style.opacity = '0'; }
}

/* ------------------------------------------------------------------ Suche */

/* Es werden alle Treffer gesammelt, aber nur haeppchenweise gezeichnet -
   sonst haengen bei "billie" zwar 29 Songs in der Liste, sichtbar sind aber
   nur die ersten acht und der Rest ist unerreichbar. Nachgeladen wird beim
   Scrollen ans Ende und wenn man mit der Pfeiltaste unten anstoesst. */
function suggest(q) {
  const n = norm(q);
  if (n.length < 2) return hideSuggest();
  const out = [], seen = new Set();
  for (const s of pool().songs) {
    let sc = 0;
    if (s.n.startsWith(n)) sc = 3;
    else if (s.n.includes(n)) sc = 2;
    else if (s.na.includes(n)) sc = 1;
    if (!sc) continue;
    const k = s.n + '|' + s.na;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([sc, s]);
  }
  /* Erst die Trefferart, dann die Bekanntheit. `f` kennt auch die alten Hits
     ohne Streamzahl - ohne das staenden sie immer ganz unten. */
  const fame = x => (x.f != null ? x.f : -1);
  out.sort((a, b) => b[0] - a[0] || fame(b[1]) - fame(a[1])
    || b[1].s - a[1].s || a[1].t.localeCompare(b[1].t));

  sugAll = out.map(x => x[1]);
  sugItems = [];
  sugIdx = -1;

  const box = $('#suggest');
  box.innerHTML = '';
  box.scrollTop = 0;
  box.hidden = !sugAll.length;
  box.onscroll = () => {
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 60) growSuggest();
  };
  growSuggest();
}

/* Zeichnet die naechste Seite. Gibt zurueck, ob etwas dazugekommen ist. */
function growSuggest() {
  const box = $('#suggest');
  const next = sugAll.slice(sugItems.length, sugItems.length + SUG_PAGE);
  if (!next.length) return false;

  next.forEach(s => {
    const b = el('button', 'sug');
    b.appendChild(el('b', null, s.t));
    b.appendChild(el('span', null, s.a));
    b.onclick = () => choose(s);
    box.appendChild(b);
  });
  sugItems = sugItems.concat(next);

  /* Der Knopf wird wiederverwendet und nur ans Ende geschoben. */
  const rest = sugAll.length - sugItems.length;
  let m = box.querySelector('.sug-more');
  if (rest > 0) {
    if (!m) { m = el('button', 'sug-more'); m.onclick = () => growSuggest(); }
    m.textContent = `${rest} weitere`;
    box.appendChild(m);
  } else if (m) m.remove();
  return true;
}

/* Auswahl umsetzen und mitscrollen - ohne das steht man beim Durchgehen mit
   den Pfeiltasten irgendwann unter dem sichtbaren Rand. */
function moveSuggest(dir) {
  if (!sugItems.length) return;
  /* Nach unten wird nachgeladen, nach oben nur innerhalb des Geladenen
     umgebrochen - sonst zeichnet ein Tastendruck die ganze Trefferliste. */
  if (dir > 0 && sugIdx >= sugItems.length - 1) growSuggest();
  sugIdx = dir > 0
    ? (sugIdx + 1 >= sugItems.length ? 0 : sugIdx + 1)
    : (sugIdx <= 0 ? sugItems.length - 1 : sugIdx - 1);
  renderSuggest();
}

function renderSuggest() {
  const box = $('#suggest');
  const rows = [...box.querySelectorAll('.sug')];
  rows.forEach((b, i) => b.classList.toggle('active', i === sugIdx));
  const act = rows[sugIdx];
  if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest' });
}

function hideSuggest() {
  sugAll = [];
  sugItems = [];
  sugIdx = -1;
  const box = $('#suggest');
  box.onscroll = null;
  box.innerHTML = '';
  box.hidden = true;
}

function choose(s) {
  pick = s;
  $('#search').value = s.t + ' – ' + s.a;
  $('#clearPick').hidden = false;
  hideSuggest();
  setAction();
  $('#actionBtn').focus();
}

function clearPick() {
  pick = null;
  $('#search').value = '';
  $('#clearPick').hidden = true;
  setAction();
  $('#search').focus();
}

/* Auf der letzten Stufe geht es nirgends mehr weiter - dort heisst der Knopf
   Aufgeben, weil genau das passiert. */
function setAction() {
  const b = $('#actionBtn');
  const r = round[active];
  const last = !!r && r.stage >= enabledStages().length - 1;
  b.classList.toggle('skip', !pick);
  b.classList.toggle('giveup', !pick && last);
  b.querySelector('.txt').textContent = pick ? 'Raten' : last ? 'Aufgeben' : 'Überspringen';
}

/* ------------------------------------------------------------- Rateversuch */

function submit() {
  const r = round[active];
  if (!r || !r.song || r.status !== 'playing') return;
  const target = r.song;
  const guess = pick;

  if (guess) {
    const ga = guess.ar || [], ta = target.ar || [];
    const correct = guess.i === target.i ||
      (norm(guess.t) === norm(target.t) && ga.some(a => ta.includes(a)));
    const artist = !correct && ga.some(a => ta.includes(a));
    r.guesses.push({ t: guess.t, a: guess.a, kind: correct ? 'ok' : artist ? 'artist' : 'no' });
    if (correct) return win(r);
  } else {
    r.guesses.push({ kind: 'skip' });
  }

  clearPick();
  const stages = enabledStages();
  if (r.stage < stages.length - 1) {
    r.stage++;
    render();
    playCurrent();
  } else {
    lose(r);
  }
}

function win(r) {
  const secs = enabledStages()[r.stage];
  r.points = Math.round((POINTS[secs] || 150) * r.tier.mult);
  r.status = 'won';
  finish(r, true);
}

function lose(r) {
  r.status = 'lost';
  r.points = 0;
  /* Hardmode: wer einen Song nicht schafft, kommt gar nicht erst zum
     naechsten - die restlichen Plaetze fallen mit. Gezaehlt wird in der
     Statistik nur der Song, den man wirklich gespielt hat. */
  if (settings.hard) {
    round.forEach(x => {
      if (x !== r && x.status === 'playing') { x.status = 'lost'; x.points = 0; }
    });
  }
  finish(r, false);
}

function finish(r, won) {
  Audio2.stop();
  clearPick();
  stats.played++;
  if (won) {
    stats.solved++;
    stats.streak = (stats.streak || 0) + 1;
    if (stats.streak > (stats.bestStreak || 0)) stats.bestStreak = stats.streak;
  } else stats.streak = 0;
  const key = r.tier.hit ? 'hits'
    : mode === 'playlist' ? 'playlist'
    : mode === 'local' ? 'local'
    : PICKED.includes(mode) ? mode.slice(0, 3) + '-' + ((currentPick() || {}).value)
    : r.tier.id;
  const bt = stats.byTier[key] || { p: 0, w: 0 };
  bt.p++; if (won) bt.w++;
  stats.byTier[key] = bt;
  save('stats', stats);
  renderStats();
  render();
  showReveal(r, won);
}

/* -------------------------------------------------------------- Auflösung */

let revealed = null;

/* Objekt-URLs auf lokale Dateien wieder freigeben, sonst haelt der Browser
   die Daten bis zum Neuladen fest. */
let localUrls = [];
function freeLocalUrls() {
  localUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  localUrls = [];
}
const localUrl = blobOrFile => {
  try {
    const u = URL.createObjectURL(blobOrFile);
    localUrls.push(u);
    return u;
  } catch (e) { return ''; }
};

function showReveal(r, won) {
  const s = r.song;
  revealed = r;
  freeLocalUrls();
  const art = $('#revealArt');
  art.hidden = !s.c;
  if (s.c) art.src = s.c.replace('100x100bb', '400x400bb');
  /* Eigene Musik: das Titelbild steckt in der Datei und wird erst jetzt
     herausgeschnitten - tausend Cover im Voraus waeren Unsinn. */
  if (!s.c && s.file && s.pic) {
    Tags.cover(s.file, s.pic).then(url => {
      if (!url) return;
      if (revealed !== r) { try { URL.revokeObjectURL(url); } catch (e) {} return; }
      localUrls.push(url);
      art.src = url;
      art.hidden = false;
    });
  }
  const datei = $('#revealFile');
  datei.hidden = !s.file;
  if (s.file) {
    datei.textContent = s.path || s.file.name;
    datei.href = localUrl(s.file);
    datei.title = 'Datei im Browser öffnen';
  }
  $('#revealTitle').textContent = s.t;
  $('#revealArtist').textContent = s.a;
  $('#revealMeta').textContent = [s.al, s.y || null,
    s.s ? (s.s / 1e9 >= 1 ? (s.s / 1e9).toFixed(2) + ' Mrd. Streams' : Math.round(s.s / 1e6) + ' Mio. Streams')
      : s.r ? `Platz ${s.r} der Jahrescharts ${s.y}` : (s.g || null),
  ].filter(Boolean).join(' · ');
  const badge = $('#revealBadge');
  if (won) {
    const secs = enabledStages()[r.stage];
    badge.className = 'badge';
    badge.textContent = `Erraten nach ${String(secs).replace('.', ',')}s · +${r.points}`;
    burst();
  } else {
    badge.className = 'badge miss';
    badge.textContent = 'Nicht erkannt';
  }
  renderServiceLinks(s);
  const last = round.every(x => x.status !== 'playing');
  $('#revealNext').textContent = last ? 'Ergebnis' : 'Weiter';
  $('#reveal').hidden = false;
  playFull(r);
}

/* Die Dienste unter der Aufloesung. Der Lieblingsdienst steht vorn und wird
   hervorgehoben; gibt es Apples Track-ID, kommt der Sammellink davor, der auf
   die richtige Aufnahme bei allen Diensten zeigt statt auf eine Suche. */
function renderServiceLinks(song) {
  const box = $('#revealLinks');
  box.innerHTML = '';
  const liste = Links.forSong(song, settings.service);
  const chip = l => {
    const a = el('a', 'svc' + (l.all ? ' all' : l.id === settings.service ? ' on' : '')
      + (l.shop ? ' shop' : '') + (l.exact ? ' exact' : ''));
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = l.name;
    if (l.hint) a.title = l.hint;
    if (l.shop) a.title = 'Kaufen statt streamen';
    if (l.exact) a.title = 'Führt direkt zu dieser Aufnahme';
    return a;
  };
  /* Standardmaessig steht nur der eigene Dienst da - und der Sammellink, wenn
     es ihn gibt. Der Rest kommt auf Klick und bleibt dann offen. */
  const zeigen = settings.svcAll ? liste : liste.filter(l => l.all || l.id === settings.service);
  zeigen.forEach(l => box.appendChild(chip(l)));
  /* Die genauen Adressen kommen von song.link und brauchen einen Moment.
     Bis dahin steht die Suche da - wer sofort klickt, landet also trotzdem
     richtig, nur eine Trefferliste weiter vorn. */
  if (settings.exact && song && song.k && !Links.known(song)) {
    Links.exact(song).then(hit => {
      if (hit && revealed && revealed.song === song) renderServiceLinks(song);
    });
  }
  if (!settings.svcAll && zeigen.length < liste.length) {
    const mehr = el('button', 'svc more', `+ ${liste.length - zeigen.length} weitere`);
    mehr.onclick = () => {
      settings.svcAll = true;
      save('settings', settings);
      renderServiceLinks(song);
    };
    box.appendChild(mehr);
  } else if (settings.svcAll && liste.length > 1) {
    const weg = el('button', 'svc more', 'weniger');
    weg.onclick = () => {
      settings.svcAll = false;
      save('settings', settings);
      renderServiceLinks(song);
    };
    box.appendChild(weg);
  }
}

function buildServiceUI() {
  const genau = $('#svcExact');
  if (genau) {
    genau.checked = settings.exact !== false;
    genau.onchange = () => {
      settings.exact = genau.checked;
      save('settings', settings);
      if (revealed) renderServiceLinks(revealed.song);
    };
  }
  const box = $('#svcSeg');
  box.innerHTML = '';
  Links.SERVICES.forEach(sv => {
    const b = el('button', 'svc' + (sv.id === settings.service ? ' on' : ''));
    b.textContent = sv.name;
    b.onclick = () => {
      settings.service = sv.id;
      save('settings', settings);
      buildServiceUI();
      if (revealed) renderServiceLinks(revealed.song);
    };
    box.appendChild(b);
  });
}

/* Nach der Aufloesung laeuft der Ausschnitt in voller Laenge, damit man hoert,
   was man da eigentlich hatte. Klick aufs Cover spielt ihn nochmal. */
function playFull(r) {
  if (r && r.buffer) Audio2.play(r.buffer, 0, r.buffer.duration);
}

function closeReveal() {
  Audio2.stop();
  freeLocalUrls();
  $('#reveal').hidden = true;
  const next = round.findIndex(r => r.status === 'playing');
  if (next >= 0) switchTo(next);
  else showSummary();
  focusSearch();
}

function showSummary() {
  Audio2.stop();
  const list = $('#summaryList');
  list.innerHTML = '';
  let total = 0;
  round.forEach(r => {
    total += r.points;
    const row = el('li', 'summary-row' + (r.status === 'won' ? ' won' : ''));
    const dot = el('span', 'tierdot');
    dot.style.background = `var(--t-${r.tier.id})`;
    row.appendChild(dot);
    row.appendChild(el('span', 's-title', r.song ? r.song.t : '–'));
    if (r.song) {
      const a = el('a', 's-link', Links.name(settings.service));
      a.href = Links.one(r.song, settings.service);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = 'Bei ' + Links.name(settings.service) + ' nachhören';
      row.appendChild(a);
    }
    row.appendChild(el('span', 's-pts', r.status === 'won' ? '+' + r.points : '—'));
    list.appendChild(row);
  });
  const geraten = round.filter(r => r.status === 'won').length;
  $('#summaryHits').textContent = `${geraten} von ${round.filter(r => r.song).length} erraten`;
  $('#summaryScore').textContent = total;
  stats.rounds++;
  if (total > stats.best) stats.best = total;
  save('stats', stats);
  renderStats();
  $('#summary').hidden = false;
}

/* --------------------------------------------------------- Songliste */

/* „Was steckt eigentlich drin?" - eine Liste des aktuellen Pools, in der man
   reinhoeren, nachhoeren und aussortieren kann. Gezeichnet wird seitenweise:
   4000 Zeilen auf einmal braucht kein Mensch und kein Browser. */

const BROW_PAGE = 40;
let browTab = 'pool';
let browAll = [];
let browShown = 0;
let browPlaying = '';        /* Schluessel des Songs, der gerade laeuft */

function buildBrowseUI() {
  document.querySelectorAll('.js-browse').forEach(b => { b.onclick = openBrowse; });
  $('#browseClose').onclick = closeBrowse;
  $('#browseDone').onclick = closeBrowse;
  $('#browse').onclick = e => { if (e.target === $('#browse')) closeBrowse(); };
  $('#browseTab').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      browTab = b.dataset.v;
      $('#browseSearch').value = '';
      renderBrowse();
    };
  });
  $('#browseSearch').oninput = () => renderBrowse();
  $('#browseReset').onclick = () => { unblockAll(); renderBrowse(); };
  const box = $('#browseList');
  box.onscroll = () => {
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 80) growBrowse();
  };
}

function openBrowse() {
  Audio2.stop();
  browTab = 'pool';
  $('#browseSearch').value = '';
  $('#browse').hidden = false;
  renderBrowse();
  setTimeout(() => $('#browseSearch').focus(), 0);
}

function closeBrowse() {
  Audio2.stop();
  browPlaying = '';
  $('#browse').hidden = true;
  focusSearch();
}

/* Entfernte Songs kennen nur Titel und Kuenstler - mehr wurde nicht
   gespeichert, und mehr braucht die Zeile auch nicht. */
function browseSource() {
  if (browTab === 'blocked') return settings.blocked.map(b => ({ t: b.t, a: b.a, key: b.key, gone: true }));
  return activePool();
}

function renderBrowse() {
  if ($('#browse').hidden) return;
  const weg = browTab === 'blocked';
  $('#browseTab').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === browTab));
  $('#browseTitle').textContent = weg ? 'Entfernte Songs' : 'Songs · ' + filterScope();

  const n = norm($('#browseSearch').value);
  browAll = browseSource().filter(s => !n || norm(s.t).includes(n) || norm(s.a).includes(n));
  browShown = 0;
  const box = $('#browseList');
  box.innerHTML = '';
  box.scrollTop = 0;

  browseNote();
  growBrowse();
}

/* Die Zeile unter dem Suchfeld - sie aendert sich auch, wenn nur eine Zeile
   verschwindet. */
function browseNote() {
  const weg = browTab === 'blocked';
  const gesucht = !!norm($('#browseSearch').value);
  $('#browseNote').textContent = weg
    ? (settings.blocked.length ? 'Zurückholen mit dem Pfeil.' : 'Nichts entfernt.')
    : `${browAll.length} Songs` + (gesucht ? ' gefunden' : ' in der Auswahl')
      + (settings.blocked.length ? ` · ${settings.blocked.length} entfernt` : '');
  $('#browseTab [data-v="blocked"]').textContent = `Entfernt (${settings.blocked.length})`;
  $('#browseReset').hidden = !settings.blocked.length;
}

function growBrowse() {
  const box = $('#browseList');
  const next = browAll.slice(browShown, browShown + BROW_PAGE);
  if (!next.length) return false;
  const alt = box.querySelector('.brow-more');
  if (alt) alt.remove();
  next.forEach(s => box.appendChild(browRow(s)));
  browShown += next.length;
  const rest = browAll.length - browShown;
  if (rest > 0) {
    const m = el('button', 'brow-more', `${rest} weitere`);
    m.onclick = () => growBrowse();
    box.appendChild(m);
  }
  return true;
}

function browRow(s) {
  const weg = !!s.gone;
  const key = s.key || songKey(s);
  const row = el('div', 'brow' + (weg ? ' gone' : ''));
  row.dataset.key = key;
  if (!weg && s.d && TIERS.some(t => t.id === s.d)) row.style.borderLeftColor = `var(--t-${s.d})`;

  const txt = el('div', 'bt');
  txt.appendChild(el('b', null, s.t || '–'));
  const unten = [s.a, s.y || null].filter(Boolean).join(' · ');
  txt.appendChild(el('span', null, unten));
  row.appendChild(txt);

  const act = el('div', 'bact');
  if (!weg && (s.p || s.file || s.full)) {
    const play = el('button', 'bplay' + (browPlaying === key ? ' on' : ''),
      browPlaying === key ? '■' : '▶');
    play.title = 'Kurz reinhören';
    play.onclick = () => {
      if (browPlaying === key) { Audio2.stop(); browPlaying = ''; return renderBrowsePlaying(); }
      browPlaying = key;
      renderBrowsePlaying();
      previewSong(s, () => { if (browPlaying === key) { browPlaying = ''; renderBrowsePlaying(); } });
    };
    act.appendChild(play);
  }

  const link = el('button', '', '↗');
  link.title = 'Wo man ihn hören kann';
  link.onclick = () => {
    const da = row.querySelector('.blinks');
    if (da) return da.remove();
    rowLinks(row, s);
    /* Wie in der Aufloesung: erst die Suche, dann - falls song.link etwas
       weiss - die genaue Adresse. */
    if (settings.exact && s.k && !Links.known(s)) {
      Links.exact(s).then(hit => { if (hit && row.querySelector('.blinks')) rowLinks(row, s); });
    }
  };
  act.appendChild(link);

  const raus = el('button', '', weg ? '↺' : '✕');
  raus.title = weg ? 'Wieder aufnehmen' : 'Aus der Auswahl nehmen';
  raus.onclick = () => {
    if (weg) unblockSong(key); else blockSong(s);
    /* Nur diese Zeile verschwindet. Die ganze Liste neu zu zeichnen wuerde
       die Scrollposition verlieren - wer den sechzigsten Song aussortiert,
       stuende sonst wieder ganz oben. */
    browAll = browAll.filter(x => (x.key || songKey(x)) !== key);
    browShown = Math.max(0, browShown - 1);
    row.remove();
    browseNote();
  };
  act.appendChild(raus);

  row.appendChild(act);
  return row;
}

/* Die Dienste unter einer Zeile - dieselbe Reihe wie in der Aufloesung. */
function rowLinks(row, s) {
  const alt = row.querySelector('.blinks');
  const box = el('div', 'blinks svc-row');
  Links.forSong(s, settings.service).forEach(l => {
    const a = el('a', 'svc' + (l.all ? ' all' : l.id === settings.service ? ' on' : '')
      + (l.shop ? ' shop' : '') + (l.exact ? ' exact' : ''));
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = l.name;
    box.appendChild(a);
  });
  if (alt) alt.replaceWith(box); else row.appendChild(box);
}

/* Nur die Abspielknoepfe nachziehen - die ganze Liste neu zu zeichnen wuerde
   die Scrollposition verlieren. */
function renderBrowsePlaying() {
  $('#browseList').querySelectorAll('.brow').forEach(row => {
    const b = row.querySelector('.bplay');
    if (!b) return;
    const an = row.dataset.key === browPlaying;
    b.classList.toggle('on', an);
    b.textContent = an ? '■' : '▶';
  });
}

/* Kurz reinhoeren: zehn Sekunden reichen, um zu wissen, was das ist. */
async function previewSong(s, done) {
  Audio2.unlock();
  try {
    let buf;
    if (s.file || s.full) {
      const cut = await Audio2.loadFile(s.file || s.full, { start: settings.start, seconds: 12 });
      buf = cut.buffer;
    } else buf = await Audio2.load(s.p);
    Audio2.play(buf, 0, Math.min(10, buf.duration), done);
  } catch (e) { if (done) done(); }
}

/* ------------------------------------------- Titelliste eines Imports */

/* Was aus der importierten Liste geworden ist: gefunden, noch offen, nicht
   gefunden. Offene lassen sich vorziehen (der Lauf nimmt immer den ersten),
   nicht gefundene noch einmal suchen - oder von Hand: die Zeile klappt eine
   Suche auf, vorbelegt mit Titel und erstem Kuenstler, und ein Klick auf
   einen Treffer ordnet ihn zu. Auch ein falscher Treffer laesst sich so
   austauschen. Was man von Hand zuordnet, merkt sich der Cache. */

let impTab = 'found';
let impOpen = '';            /* Titel, dessen Suche gerade aufgeklappt ist */
let impPlaying = '';

const LUPE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" '
  + 'stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>';
const NACH_VORN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" '
  + 'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14M12 20V9M7 13l5-5 5 5"/></svg>';
const IMP_VIA = { cache: 'schon bekannt', local: 'aus der Songliste', stored: '',
                  artist: 'über den Künstlerkatalog', search: 'über die Suche', manual: 'von Hand' };

function buildImportUI() {
  $('#impClose').onclick = closeImport;
  $('#impDone').onclick = closeImport;
  $('#imp').onclick = e => { if (e.target === $('#imp')) closeImport(); };
  $('#impTab').querySelectorAll('button').forEach(b => {
    b.onclick = () => { impTab = b.dataset.v; impOpen = ''; $('#impSearch').value = ''; renderImport(true); };
  });
  $('#impSearch').oninput = () => renderImport(true);
  $('#impAll').onclick = () => {
    const keys = impRows().map(t => t.key);
    if (!plJob || !keys.length) return;
    if (impTab === 'missed') Playlist.retry(plJob, keys);
    else if (impTab === 'pending') Playlist.prio(plJob, keys);
    impKick();
  };
  $('#impRun').onclick = () => {
    if (plBusy) { plStop = true; return; }
    if (plJob) runResolve(plJob);
    renderImport(true);
  };
}

function openImport(tab) {
  if (!plJob) return;
  Audio2.stop();
  impTab = tab || (plBusy ? 'pending' : plJob.missed.size ? 'missed' : 'found');
  impOpen = '';
  impPlaying = '';
  $('#impSearch').value = '';
  $('#imp').hidden = false;
  renderImport(true);
}

function closeImport() {
  Audio2.stop();
  impPlaying = '';
  impOpen = '';
  $('#imp').hidden = true;
  focusSearch();
}

/* Nach Vorziehen oder Nochmal: laeuft nichts, geht es gleich los. */
function impKick() {
  Playlist.storeQueue(plJob);
  if (!plBusy && plJob.pending.length) runResolve(plJob);
  renderPlaylist();
  renderImport(true);
}

function impRows() {
  const j = plJob;
  if (!j) return [];
  const n = norm($('#impSearch').value);
  const list = impTab === 'found' ? j.tracks.filter(t => j.found.has(t.key))
    : impTab === 'missed' ? j.tracks.filter(t => j.missed.has(t.key))
    : j.pending.slice();
  if (!n) return list;
  return list.filter(t => {
    const f = j.found.get(t.key);
    return norm(t.title + ' ' + t.artist).includes(n) || (f && norm(f.song.t + ' ' + f.song.a).includes(n));
  });
}

/* `voll`: Liste neu aufbauen. Ohne wird waehrend eines Laufs laufend
   nachgezeichnet, aber nie, solange eine Suche aufgeklappt ist - sonst
   verschwaende beim Tippen das Feld. */
function renderImport(voll) {
  if ($('#imp').hidden || !plJob) return;
  const j = plJob, total = j.tracks.length;
  const f = j.found.size, m = j.missed.size, o = j.pending.length;
  $('#impTitle').textContent = 'Titelliste · ' + j.name;
  const zahl = { found: f, pending: o, missed: m };
  $('#impTab').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === impTab);
    b.textContent = { found: 'Gefunden', pending: 'Offen', missed: 'Fehlt' }[b.dataset.v]
      + ` (${zahl[b.dataset.v]})`;
  });
  fillBar($('#impBar'), f, m, total);
  $('#impNote').textContent = plBusy
    ? `${f + m} von ${total} durchsucht · ${f} gefunden` + (plWait ? ` · Apple bremst – weiter in ${plWait} s` : '')
    : `${f} gefunden · ${m} nicht gefunden` + (o ? ` · ${o} offen` : '');

  const rows = impRows();
  const gesucht = !!norm($('#impSearch').value);
  const all = $('#impAll');
  all.hidden = !rows.length || impTab === 'found' || (impTab === 'pending' && !gesucht);
  all.textContent = impTab === 'missed' ? `Alle ${rows.length} nochmal` : `Diese ${rows.length} vorziehen`;
  const run = $('#impRun');
  run.hidden = !plBusy && !o;
  run.textContent = plBusy ? 'Anhalten' : `Weiter suchen (${o})`;

  if (impOpen && !voll) return;
  const box = $('#impList');
  const top = box.scrollTop;
  box.innerHTML = '';
  if (!rows.length) {
    box.appendChild(el('p', 'note', impTab === 'missed' ? 'Alles gefunden.'
      : impTab === 'pending' ? 'Nichts mehr offen.' : 'Noch nichts gefunden.'));
  }
  rows.forEach(t => box.appendChild(impRow(t)));
  box.scrollTop = top;
}

/* Exportify und Spotify trennen Kuenstler mit Semikolon - lesen soll man Kommas. */
const wer = a => String(a || '').replace(/\s*;\s*/g, ', ');

function impRow(t) {
  const j = plJob;
  const f = j.found.get(t.key);
  const row = el('div', 'brow imp' + (j.current === t.key ? ' now' : ''));
  row.dataset.key = t.key;

  const txt = el('div', 'bt');
  if (f) {
    txt.appendChild(el('b', null, f.song.t));
    txt.appendChild(el('span', null, [f.song.a, IMP_VIA[f.via]].filter(Boolean).join(' · ')));
    /* Weicht der Treffer im Titel ab, steht das Original darunter - so
       faellt ein falscher Treffer auf. */
    if (Playlist.base(f.song.t) !== Playlist.base(t.title)) {
      txt.appendChild(el('span', 'orig', `In der Liste: ${t.title}${t.artist ? ' – ' + wer(t.artist) : ''}`));
    }
  } else {
    txt.appendChild(el('b', null, t.title || '–'));
    txt.appendChild(el('span', null, [wer(t.artist), j.current === t.key ? 'wird gerade gesucht' : '']
      .filter(Boolean).join(' · ')));
  }
  row.appendChild(txt);

  const act = el('div', 'bact');
  const knopf = (zeichen, titel, fn, cls) => {
    const b = el('button', cls || '', zeichen);
    b.title = titel;
    b.setAttribute('aria-label', titel);
    b.onclick = fn;
    act.appendChild(b);
    return b;
  };
  if (f) {
    const an = impPlaying === t.key;
    knopf(an ? '■' : '▶', 'Kurz reinhören', () => impPreview(t.key, f.song), 'bplay' + (an ? ' on' : ''));
  }
  if (!f && j.missed.has(t.key)) {
    knopf('↻', 'Nochmal automatisch suchen', () => { Playlist.retry(j, t.key); impKick(); });
  }
  if (!f && !j.missed.has(t.key)) {
    knopf('', 'Vorziehen', () => { Playlist.prio(j, t.key); impKick(); }).innerHTML = NACH_VORN;
  }
  const lupe = knopf('', f ? 'Anderen Song zuordnen' : 'Selbst suchen', () => {
    impOpen = impOpen === t.key ? '' : t.key;
    renderImport(true);
  }, impOpen === t.key ? 'on' : '');
  lupe.innerHTML = LUPE;
  if (f) {
    knopf('✕', 'Falscher Treffer – herausnehmen', () => {
      Playlist.assign(j, t.key, null);
      plSync();
      renderPlaylist();
      renderImport(true);
    });
  }
  row.appendChild(act);
  if (impOpen === t.key) row.appendChild(impFinder(t));
  return row;
}

function impPreview(key, song) {
  if (impPlaying === key) { Audio2.stop(); impPlaying = ''; return renderImport(true); }
  impPlaying = key;
  renderImport(true);
  previewSong(song, () => { if (impPlaying === key) { impPlaying = ''; renderImport(true); } });
}

/* Die Suche unter einer Zeile. Vorbelegt mit Grundtitel und erstem
   Kuenstler - genau das, was auch die automatische Suche zuerst probiert;
   meist reicht es, ein Wort zu aendern. */
function impFinder(t) {
  const box = el('div', 'imp-find');
  const inp = el('input');
  inp.type = 'text';
  inp.value = Playlist.hintOf(t);
  inp.placeholder = 'Titel und Künstler';
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  const hits = el('div', 'fopts');
  const note = el('p', 'note');
  let timer = null, lauf = 0;

  const go = async () => {
    const q = inp.value.trim();
    if (q.length < 2) return;
    const meins = ++lauf;
    note.textContent = 'Wird gesucht …';
    try {
      const res = await Playlist.find(q, 'song');
      if (meins !== lauf) return;
      hits.innerHTML = '';
      note.textContent = res.length ? 'Antippen ordnet zu.' : 'Nichts gefunden – anders schreiben?';
      res.slice(0, 15).forEach(h => {
        const zeile = el('div', 'imp-hit');
        const wahl = el('button', 'arhit');
        wahl.appendChild(el('span', 'nm', h.t + (h.a ? ' – ' + h.a : '')));
        wahl.appendChild(el('span', 'sub', String(h.y || '')));
        wahl.onclick = () => {
          Playlist.assign(plJob, t.key, h);
          impOpen = '';
          plSync();
          renderPlaylist();
          renderImport(true);
        };
        const hoer = el('button', 'bplay', '▶');
        hoer.title = 'Kurz reinhören';
        hoer.onclick = () => {
          Audio2.stop();
          hoer.textContent = '■';
          previewSong(h, () => { hoer.textContent = '▶'; });
        };
        zeile.append(wahl, hoer);
        hits.appendChild(zeile);
      });
    } catch (e) {
      if (meins !== lauf) return;
      note.textContent = e && e.throttled ? 'Apple bremst gerade – gleich nochmal.' : 'Die Suche kam nicht durch.';
    }
  };
  inp.oninput = () => { clearTimeout(timer); timer = setTimeout(go, 400); };
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); go(); }
    if (e.key === 'Escape') { e.stopPropagation(); impOpen = ''; renderImport(true); }
  };
  box.append(inp, hits, note);
  setTimeout(() => { if (inp.isConnected) inp.focus(); go(); }, 0);
  return box;
}

/* ------------------------------------------------------- Ausklappbares */

/* Mit sechs Modi, drei Quellen und den Einstellungen wird die Spalte lang.
   Zugeklappt steht die Antwort in der Zeile selbst - „Nachhören bei ·
   Spotify" -, aufgeklappt wird nur, was man gerade wirklich ändern will.
   Der Zustand wird gemerkt. */
function buildPanels() {
  document.querySelectorAll('details.panel[data-k]').forEach(d => {
    const k = d.dataset.k;
    d.open = !!(settings.open || {})[k];
    d.addEventListener('toggle', () => {
      settings.open = { ...(settings.open || {}), [k]: d.open };
      save('settings', settings);
    });
  });
  renderPanelSums();
}

/* Was in der zugeklappten Zeile steht. */
function panelSum(k) {
  const nichts = 'nichts geladen';
  if (k === 'stages') {
    const an = settings.stages.filter(Boolean).length;
    return [`${an} von ${STAGES.length}`, an < 2];
  }
  if (k === 'stats') {
    return [stats.played ? `${stats.solved}/${stats.played} · ${Math.round(stats.solved / stats.played * 100)} %`
      : 'noch nichts gespielt', false];
  }
  if (k === 'playlist') {
    if (plBusy && plJob) {
      return [`${plJob.found.size}/${plJob.tracks.length}`
        + (plWait ? ` · Pause ${plWait} s` : ' gefunden …'), false];
    }
    return [PL ? `${PL.name} · ${PL.songs.length} Songs` : nichts, false];
  }
  if (k === 'artist') {
    const n = (typeof Artist !== 'undefined' ? Artist.all() : []).length;
    if (mode === 'artist' && currentPick()) return [currentPick().text, false];
    return [n ? `${n} geladen` : nichts, false];
  }
  if (k === 'local') {
    if (loBusy || srvBusy) return ['wird gelesen …', false];
    return [LO ? `${LO.name} · ${LO.songs.length} Songs` : nichts, false];
  }
  if (k === 'service') return [Links.name(settings.service), false];
  if (k === 'play') {
    return [`${settings.hits ? 'Heimspiel' : settings.draw === 'random' ? '5 zufällige' : 'gestuft'}`
      + `${settings.hard ? ' · Hardmode' : ''} · `
      + `${settings.start === 'random' ? 'zufällige Stelle' : 'Anfang'} · `
      + `${Math.round(settings.volume * 100)} %`, false];
  }
  if (k === 'filter') {
    const n = activePool().length;
    const min = (mode === 'playlist' || mode === 'local' || settings.hits) ? PL_MIN : Filters.MIN_POOL;
    const rules = activeFilters().length;
    /* Worauf die Regeln wirken, gehoert dazu: jeder Modus hat seinen eigenen
       Satz, und wer das nicht sieht, wundert sich. */
    return [`${filterScope()} · ${n} Songs`
      + (rules ? ` · ${rules} Regel${rules > 1 ? 'n' : ''}` : ''), n < min];
  }
  return ['', false];
}

/* Worauf sich die Songauswahl gerade bezieht. */
function filterScope() {
  const dazu = settings.hits ? ' · Heimspiel' : '';
  if (mode === 'playlist') return 'Playlist' + dazu;
  if (mode === 'local') return (LO ? LO.name : 'Eigene Musik') + dazu;
  if (PICKED.includes(mode)) { const now = currentPick(); return (now ? now.text : '–') + dazu; }
  return 'Charts' + dazu;
}

function renderPanelSums() {
  document.querySelectorAll('details.panel[data-k]').forEach(d => {
    const box = d.querySelector('summary .psum');
    if (!box) return;
    const [text, warn] = panelSum(d.dataset.k);
    box.textContent = text;
    box.classList.toggle('warn', !!warn);
  });
}

/* ------------------------------------------------------------- Rendering */

function render() {
  const r = round[active];
  const stages = enabledStages();

  $('#tierList').querySelectorAll('.tier-item').forEach((b, i) => {
    b.setAttribute('aria-current', i === active);
    b.classList.toggle('locked', locked(i));
    const d = b.querySelector('.dot');
    d.className = 'dot' + (round[i] ? (round[i].status === 'won' ? ' won' : round[i].status === 'lost' ? ' lost' : '') : '');
  });
  $('#tabs').querySelectorAll('.tab').forEach((b, i) => {
    b.setAttribute('aria-selected', i === active);
    b.classList.toggle('done', round[i] && round[i].status !== 'playing');
    b.classList.toggle('locked', locked(i));
  });

  const bar = $('#stageBar');
  bar.querySelectorAll('.stage-seg').forEach(n => n.remove());
  if (!bar.querySelector('.stage-progress')) bar.appendChild(el('div', 'stage-progress'));
  segmentWidths().forEach((w, pos) => {
    const seg = el('div', 'stage-seg');
    seg.style.flex = w;
    if (r && pos < r.stage) seg.classList.add('filled');
    if (r && pos === r.stage) seg.classList.add('current');
    bar.appendChild(seg);
  });

  const secs = r ? stages[r.stage] : stages[0];
  $('#stageLabel').textContent = String(secs).replace('.', ',') + 's';

  const gl = $('#guessList');
  gl.innerHTML = '';
  if (r) r.guesses.forEach(g => {
    const row = el('div', 'guess ' + (g.kind === 'ok' ? 'ok' : g.kind === 'artist' ? 'artist' : g.kind === 'skip' ? 'skip' : ''));
    row.appendChild(el('span', 'mark'));
    if (g.kind === 'skip') row.appendChild(el('span', null, 'Übersprungen'));
    else {
      row.appendChild(el('span', 'g-title', g.t));
      row.appendChild(el('span', 'g-artist', g.a));
      if (g.kind === 'artist') row.appendChild(el('span', 'g-note', 'Künstler stimmt'));
      if (g.kind === 'ok') row.appendChild(el('span', 'g-note ok', 'Richtig'));
    }
    gl.appendChild(row);
  });

  const over = !r || !r.song || r.status !== 'playing';
  $('#search').disabled = over;
  $('#actionBtn').disabled = over;
  $('#playBtn').classList.toggle('loading', !!r && !r.buffer && !r.error);
  $('#search').placeholder = r && !r.song ? 'Kein Song passt zu den Filtern'
    : r && r.error ? 'Song nicht ladbar – Cmd+Enter würfelt neu'
    : mode === 'playlist' ? 'Song aus der Playlist suchen …'
    : mode === 'local' ? 'Song aus deiner Musik suchen …'
    : mode === 'artist' && currentPick() ? `Song von ${currentPick().text} suchen …`
    : 'Song suchen …';
  $('#roundScore').textContent = round.reduce((a, b) => a + b.points, 0);
  setAction();
  renderPanelSums();
}

/* `stats.byTier` sammelt seit jeher pro Stufe, Jahrzehnt, Genre und Playlist -
   angezeigt wurde es nie. Hier zusammengefasst, aber nur was bespielt wurde. */
function statGroups() {
  const groups = [
    ['Charts', k => TIERS.some(t => t.id === k) || /^pl\d$/.test(k)],
    ['Heimspiel', k => k === 'hits'],
    ['Jahrzehnte', k => k.startsWith('dec-')],
    ['Genres', k => k.startsWith('gen-')],
    ['Künstler', k => k.startsWith('art-')],
    ['Playlist', k => k === 'playlist'],
    ['Eigene Musik', k => k === 'local'],
  ];
  return groups.map(([label, test]) => {
    let p = 0, w = 0;
    Object.keys(stats.byTier || {}).forEach(k => {
      if (!test(k)) return;
      p += stats.byTier[k].p || 0;
      w += stats.byTier[k].w || 0;
    });
    return [label, p, w];
  }).filter(([, p]) => p > 0);
}

function renderStats() {
  const d = $('#stats');
  d.innerHTML = '';
  const rate = stats.played ? Math.round(stats.solved / stats.played * 100) : 0;
  const rows = [['Runden', stats.rounds], ['Songs erraten', `${stats.solved}/${stats.played}`],
    ['Quote', rate + ' %'], ['Serie', `${stats.streak || 0} (best ${stats.bestStreak || 0})`],
    ['Bestes Ergebnis', stats.best]];
  const groups = statGroups();
  if (groups.length > 1) rows.push(...groups.map(([label, p, w]) => [label, `${w}/${p}`]));
  rows.forEach(([k, v]) => { d.appendChild(el('dt', null, k)); d.appendChild(el('dd', null, v)); });
  renderPanelSums();
}

/* --------------------------------------------------------- Songauswahl */

/* ---- Auswahl im Jahrzehnte- und Genremodus ---- */

const PICKED = ['decades', 'genres', 'artist'];   /* Modi mit Auswahlleiste oben */
/* Ohne Stufen gibt es keinen Grund, die Songs aus den Jahrescharts
   auszulassen - die fehlende Streamzahl stoert nur beim Einsortieren. */
const basePool = () => (mode === 'playlist' ? plFiltered
  : mode === 'local' ? loFiltered
  : PICKED.includes(mode) ? pickFiltered
  : usesTiers() ? chartFiltered : filtered);
/* Was gezogen werden kann - im Heimspiel nur die grossen Hits davon. */
const activePool = () => (settings.hits ? hitPool(basePool()) : basePool());

/* Ein Jahrzehnt oder Genre braucht genug Songs, sonst ist die Runde nach zwei
   Partien auswendig gelernt. Genres brauchen mehr, weil sie sich nicht ueber
   die Zeit verteilen. */
const DEC_MIN = 10;
const GEN_MIN = 20;

/* Die Auswahl fuer einen Modus als [{ value, text }]. */
function listFor(m) {
  const cnt = new Map(), label = new Map();
  const collect = (key, text) => {
    if (!key) return;
    cnt.set(key, (cnt.get(key) || 0) + 1);
    label.set(key, text);
  };
  if (m === 'decades') {
    filtered.forEach(s => { const d = Filters.decadeOf(s); collect(d, d + 'er'); });
    return [...cnt].filter(([, n]) => n >= DEC_MIN).sort((a, b) => a[0] - b[0])
      .map(([v]) => ({ value: v, text: label.get(v) }));
  }
  if (m === 'genres') {
    filtered.forEach(s => { const g = Filters.genreOf(s); collect(norm(g), g); });
    return [...cnt].filter(([, n]) => n >= GEN_MIN).sort((a, b) => b[1] - a[1])
      .map(([v]) => ({ value: v, text: label.get(v) }));
  }
  if (m === 'artist') {
    /* Die geladenen Kataloge, zuletzt geholter zuerst. */
    return Artist.all().filter(a => a.songs.length >= Artist.MIN_SONGS)
      .map(a => ({ value: a.id, text: a.name }));
  }
  return [];
}

const pickList = () => listFor(mode);
const pickSetting = () => (mode === 'genres' ? settings.genre
  : mode === 'artist' ? settings.artist : settings.decade);
const inPick = (s, value) => (mode === 'decades'
  ? Filters.decadeOf(s) === value
  : norm(Filters.genreOf(s)) === value);

/* Fuenf Stufen brauchen genug Songs. Reicht es nicht, wird das Jahrzehnt oder
   Genre wie eine Playlist gespielt: fuenf zufaellige Songs, keine Stufen.
   Im Kuenstlermodus gibt es nie Stufen - wer einen Kuenstler mit einem
   grossen Hit waehlt, haette den sonst als Easy sofort auf dem Tisch. */
const usesTiers = () => settings.draw !== 'random' && !settings.hits && (mode === 'charts'
  || (PICKED.includes(mode) && mode !== 'artist' && pickFiltered.length >= TIER_MIN * TIERS.length));

/* Das gespeicherte Jahrzehnt oder Genre kann durch Filter oder neue Daten
   wegfallen - dann greift das naechstliegende. */
function currentPick() {
  const list = pickList();
  if (!list.length) return null;
  const want = pickSetting();
  const hit = list.find(o => String(o.value) === String(want));
  if (hit) return hit;
  if (mode === 'decades') {
    return list.reduce((best, o) =>
      Math.abs(o.value - want) < Math.abs(best.value - want) ? o : best, list[0]);
  }
  return list[0];
}

function stepPick(dir) {
  const list = pickList();
  if (list.length < 2) return;
  const now = currentPick();
  const i = list.findIndex(o => String(o.value) === String(now.value));
  const next = list[(i + dir + list.length) % list.length].value;
  if (mode === 'genres') settings.genre = next;
  else if (mode === 'artist') settings.artist = next;
  else settings.decade = next;
  save('settings', settings);
  applyFilters();
  newRound();
}

function renderPicker() {
  const bar = $('#pickBar');
  if (!bar) return;
  bar.hidden = !PICKED.includes(mode);
  if (bar.hidden) return;
  const now = currentPick();
  $('#pickLabel').textContent = now ? now.text : '–';
  $('#pickCount').textContent = settings.hits
    ? `${activePool().length} Hits aus ${pickFiltered.length}`
    : `${pickFiltered.length} Songs` + (usesTiers() ? '' : ' · ohne Stufen');
  const only = pickList().length < 2;
  $('#pickPrev').disabled = only;
  $('#pickNext').disabled = only;
}

/* ---- Filter ---- */

/* Der Pool wird neu gerechnet, die laufende Runde aber nicht angefasst -
   sonst waere ein Klick auf einen Filter dasselbe wie Aufgeben. */
function applyFilters() {
  filtered = unblocked(Filters.apply(DB.songs, settings.filters, DB));
  /* Songs aus den Jahrescharts haben keine Streamzahl und damit keine Stufe -
     die Charts lassen sie aus, im Jahrzehntmodus spielen sie mit. */
  chartFiltered = filtered.filter(s => s.d);
  plFiltered = PL ? unblocked(Filters.apply(PL.songs, settings.plFilters, PL)) : [];
  loFiltered = LO ? unblocked(Filters.apply(LO.songs, settings.loFilters, LO)) : [];

  if (mode === 'artist') {
    /* Der Kuenstlerkatalog kommt nicht aus songs.json, sondern von Apple. */
    const now = currentPick();
    AR = now ? buildPlaylist(Artist.fromCache(now.value)) : null;
    pickFiltered = AR ? unblocked(Filters.apply(AR.songs, settings.arFilters, AR)) : [];
  } else if (PICKED.includes(mode)) {
    const now = currentPick();
    pickFiltered = now ? filtered.filter(s => inPick(s, now.value)) : [];
    relativeTiers(pickFiltered);
  } else {
    pickFiltered = [];
    TIERS.forEach(t => byTier[t.id] = chartFiltered.filter(s => s.d === t.id));
  }

  rebuildFilterLists();
  renderPicker();
  renderFilters();
}

/* Die Stufen der Charts haengen an absoluten Streamzahlen. Fuer ein einzelnes
   Jahrzehnt taugt das nicht: Spotify gibt es erst seit 2008, ein Welthit von
   1985 hat dort weniger Streams als ein mittelmaessiger Song von 2021. Also
   wird innerhalb des Jahrzehnts sortiert und in fuenf gleich grosse Teile
   geschnitten - das oberste Fuenftel ist Easy. */
function relativeTiers(list) {
  /* `f` ist die von der Pipeline gerechnete Bekanntheit im Jahrzehnt (Streams
     und Jahreschartplatz gemischt). Aeltere songs.json kennt sie nicht, dann
     entscheiden die Streams. */
  const useFame = list.some(s => s.f != null);
  const val = s => (useFame ? (s.f != null ? s.f : 50) : (s.s || 0));
  const sorted = list.slice().sort((a, b) => val(b) - val(a));
  TIERS.forEach(t => byTier[t.id] = []);
  if (!sorted.length) return;
  const per = sorted.length / TIERS.length;
  sorted.forEach((song, i) => {
    const idx = Math.min(TIERS.length - 1, Math.floor(i / per));
    byTier[TIERS[idx].id].push(song);
  });
}

/* Die Auswahllisten kommen aus dem Pool, der gerade gilt - in der Playlist
   stehen also ihre Genres und Kuenstler, nicht die der Charts. */
function rebuildFilterLists() {
  if (!$('#gGenre')) return;
  buildOptionList('#gGenre', 'genre');
  buildOptionList('#gDecade', 'decade');
  renderArtistHits($('#fArtist').value);
  /* Im Jahrzehntmodus waehlt die Leiste oben das Jahrzehnt - eine zweite
     Stelle dafuer koennte den Pool nur widerspruechlich machen. */
  $('#gDecade').hidden = mode === 'decades';
  $('#gGenre').hidden = mode === 'genres';
}

function buildFilterUI() {
  $('#fMode').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      filterMode = b.dataset.v;
      $('#fMode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      renderFilters();
    };
  });

  $('#fInst').onchange = () => {
    const list = activeFilters().filter(r => r.type !== 'instrumental');
    if ($('#fInst').checked) list.push({ mode: 'ohne', type: 'instrumental', value: '', text: 'Instrumental' });
    setFilters(list);
    applyFilters();
  };

  $('#fReset').onclick = () => {
    setFilters(Filters.DEFAULT.map(r => ({ ...r })));
    applyFilters();
  };

  const art = $('#fArtist');
  art.oninput = () => renderArtistHits(art.value);
  art.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = $('#gArtist').querySelector('.fopt');
    if (first) first.click();
  };

  buildOptionList('#gGenre', 'genre');
  buildOptionList('#gDecade', 'decade');
  renderArtistHits('');
  renderFilters();
}

/* Haekchenliste fuer Genres und Jahrzehnte. Steht komplett da - anklicken
   statt tippen, damit man sich nicht vertippen kann. */
function buildOptionList(sel, type) {
  const box = $(sel).querySelector('.fopts');
  box.innerHTML = '';
  const db = pool();
  const cnt = Filters.counts(type, db);
  const opts = Filters.options(type, db);
  if (!opts.length) { box.appendChild(el('p', 'fnote', 'Nichts zur Auswahl.')); return; }
  opts.forEach(o => box.appendChild(optionRow(type, o, cnt.get(o.value) || 0)));
}

function optionRow(type, o, n) {
  const row = el('button', 'fopt');
  row.dataset.type = type;
  row.dataset.value = o.value;
  row.appendChild(el('span', 'box'));
  row.appendChild(el('span', 'txt', o.text));
  row.appendChild(el('span', 'num', n ? String(n) : ''));
  row.onclick = () => toggleRule(type, o);
  return row;
}

function renderArtistHits(q) {
  const box = $('#gArtist').querySelector('.fopts');
  box.innerHTML = '';
  const db = pool();
  const cnt = Filters.counts('artist', db);
  const n = norm(q);
  const opts = Filters.options('artist', db);
  const hits = (n
    ? opts.filter(o => o.value.includes(n))
        .sort((a, b) => (a.value.startsWith(n) ? 0 : 1) - (b.value.startsWith(n) ? 0 : 1)
          || (cnt.get(b.value) || 0) - (cnt.get(a.value) || 0))
    : activeFilters().filter(r => r.type === 'artist').map(r => ({ value: r.value, text: r.text }))
  ).slice(0, 20);

  if (!hits.length) {
    box.appendChild(el('p', 'fnote', n ? 'Kein Künstler mit diesem Namen.' : 'Tippen, um zu suchen.'));
    return;
  }
  hits.forEach(o => box.appendChild(optionRow('artist', o, cnt.get(o.value) || 0)));
  markRules();
}

/* Klick auf eine Zeile: gleicher Modus schaltet ab, anderer schaltet um. */
function toggleRule(type, o) {
  const list = activeFilters().slice();
  const idx = list.findIndex(r => r.type === type && String(r.value) === String(o.value));
  const had = idx >= 0 ? list[idx] : null;
  if (idx >= 0) list.splice(idx, 1);
  if (!had || had.mode !== filterMode) list.push({ mode: filterMode, type, value: o.value, text: o.text });
  setFilters(list);
  applyFilters();
}

function removeFilter(i) {
  const list = activeFilters().slice();
  list.splice(i, 1);
  setFilters(list);
  applyFilters();
}

/* Haekchen und Farbe der Zeilen an die aktiven Regeln angleichen. */
function markRules() {
  const rules = activeFilters();
  document.querySelectorAll('.fopt').forEach(row => {
    const r = rules.find(x => x.type === row.dataset.type && String(x.value) === row.dataset.value);
    row.classList.toggle('on', !!r);
    ['nur', 'ohne', 'dazu'].forEach(m => row.classList.toggle(m, !!r && r.mode === m));
  });
  [['#gGenre', 'genre'], ['#gDecade', 'decade'], ['#gArtist', 'artist']].forEach(([sel, type]) => {
    const n = rules.filter(r => r.type === type).length;
    $(sel).querySelector('.fcount').textContent = n ? ` · ${n}` : '';
  });
}

function renderFilters() {
  const rules = activeFilters();
  const now = PICKED.includes(mode) ? currentPick() : null;

  const box = $('#filterList');
  box.innerHTML = '';
  rules.forEach((r, i) => {
    const chip = el('div', 'frule ' + r.mode);
    chip.appendChild(el('span', null, Filters.label(r)));
    const x = el('button', null, '×');
    x.title = 'Filter entfernen';
    x.onclick = () => removeFilter(i);
    chip.appendChild(x);
    box.appendChild(chip);
  });
  $('#fReset').hidden = !rules.length;
  $('#fInst').checked = rules.some(r => r.type === 'instrumental' && r.mode === 'ohne');
  markRules();

  const n = basePool().length;
  const c = $('#filterCount');
  let warn = true, msg;
  if (mode === 'playlist') {
    const total = PL ? PL.songs.length : 0;
    if (!n) msg = 'Kein Song der Playlist passt zu den Filtern.';
    else if (n < PL_MIN) msg = `Nur ${n} von ${total} Songs übrig – für eine Runde braucht es ${PL_MIN}.`;
    else { msg = `${n} von ${total} Songs der Playlist`; warn = false; }
  } else if (mode === 'local') {
    const total = LO ? LO.songs.length : 0;
    if (!n) msg = 'Kein Song deiner Musik passt zu den Filtern.';
    else if (n < Local.MIN) msg = `Nur ${n} von ${total} Songs übrig – für eine Runde braucht es ${Local.MIN}.`;
    else { msg = `${n} von ${total} eigenen Songs`; warn = false; }
  } else if (PICKED.includes(mode)) {
    const what = now ? now.text : '–';
    if (!n) msg = `Kein Song aus ${what} passt zu den Filtern.`;
    else if (n < Filters.MIN_POOL) msg = `Nur ${n} Songs in ${what} – das wird schnell vorhersehbar.`;
    else { msg = `${n} Songs in ${what}`; warn = false; }
  } else {
    const empty = TIERS.filter(t => !(byTier[t.id] || []).length).map(t => t.label);
    if (!n) msg = 'Kein Song passt zu den Filtern.';
    else if (n < Filters.MIN_POOL) msg = `Nur ${n} Songs übrig – das wird schnell vorhersehbar.`;
    else if (empty.length && usesTiers()) msg = `${n} Songs · leer: ${empty.join(', ')} – dort kommt Ersatz aus dem Rest.`;
    else { msg = `${n} Songs im Pool`; warn = false; }
  }
  /* Im Heimspiel zaehlt, was davon gross genug ist. */
  if (settings.hits && n) {
    const h = activePool().length;
    msg += ` · im Heimspiel die ${h} bekanntesten`;
    warn = h < PL_MIN;
  }
  c.textContent = msg;
  c.classList.toggle('warn', warn);
  renderPanelSums();
}

/* ---------------------------------------------------------- Kuenstler */

let arBusy = false;
let arTimer = null;

function buildArtistUI() {
  const inp = $('#arSearch');
  inp.oninput = () => {
    clearTimeout(arTimer);
    const q = inp.value.trim();
    if (q.length < 2) return renderArtists();
    /* Erst die schon geladenen zeigen, dann bei Apple nachfragen - aber nicht
       bei jedem Tastendruck. */
    renderArtists(localArtists(q));
    arTimer = setTimeout(() => searchArtists(q), 450);
  };
  inp.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(arTimer);
    if (inp.value.trim().length >= 2) searchArtists(inp.value.trim());
  };
  renderArtists();
}

/* Kuenstler, deren Katalog schon im Browser liegt. */
function localArtists(q) {
  const n = norm(q);
  return Artist.all().filter(a => norm(a.name).includes(n))
    .map(a => ({ id: a.id, name: a.name, songs: a.songs.length }));
}

async function searchArtists(q) {
  if (arBusy) return;
  arBusy = true;
  arNote('Wird gesucht …');
  try {
    const hits = await Artist.find(q);
    const drin = new Set(Artist.all().map(a => String(a.id)));
    renderArtists(hits.map(h => ({ ...h, songs: drin.has(String(h.id))
      ? Artist.fromCache(h.id).songs.length : null })));
    arNote(hits.length ? '' : 'Keinen Künstler mit diesem Namen gefunden.');
  } catch (e) {
    arNote(e.throttled ? 'Apple bremst gerade – in ein paar Minuten nochmal.'
      : 'Die Suche hat nicht geklappt.');
  }
  arBusy = false;
}

function renderArtists(hits) {
  const box = $('#arHits');
  box.innerHTML = '';
  const liste = hits || Artist.all().map(a => ({ id: a.id, name: a.name, songs: a.songs.length }));
  if (!liste.length) {
    box.appendChild(el('p', 'fnote', 'Namen eingeben und Enter drücken.'));
    return;
  }
  const jetzt = String((currentPick() || {}).value);
  liste.slice(0, 12).forEach(h => {
    const row = el('button', 'arhit' + (String(h.id) === jetzt ? ' on' : ''));
    row.appendChild(el('span', 'nm', h.name));
    row.appendChild(el('span', 'sub', h.songs != null ? h.songs + ' Songs'
      : h.genre || 'laden'));
    row.onclick = () => pickArtist(h);
    box.appendChild(row);
  });
}

function arNote(msg) { $('#arStatus').textContent = msg; }

/* Katalog holen (oder aus dem Speicher nehmen) und in den Modus wechseln. */
async function pickArtist(h) {
  if (arBusy) return;
  arBusy = true;
  arNote(`${h.name}: Songs werden geholt …`);
  try {
    const entry = await Artist.load({ id: h.id, name: h.name },
      { onProgress: t => arNote(`${h.name}: ${t}`) });
    if (entry.songs.length < Artist.MIN_SONGS) {
      arNote(`${h.name}: nur ${entry.songs.length} Songs gefunden – zu wenig für eine Runde.`);
      arBusy = false;
      return;
    }
    settings.artist = entry.id;
    save('settings', settings);
    arBusy = false;
    if (mode === 'artist') { applyFilters(); newRound(); }
    else setMode('artist');
    arNote(`${entry.name}: ${entry.songs.length} Songs`);
    renderArtists();
  } catch (e) {
    arNote(e.throttled ? 'Apple bremst gerade – in ein paar Minuten nochmal.'
      : 'Der Katalog liess sich nicht laden.');
    arBusy = false;
  }
}

/* ---------------------------------------------------------- Eigene Musik */

/* Die Dateien bleiben auf dem Geraet - der Browser darf sie lesen, mehr
   passiert nicht. Wo es geht (Chrome, Edge), wird der Ordner gemerkt und
   beim naechsten Besuch wieder geoeffnet; sonst muss man ihn erneut waehlen,
   das laesst sich nicht umgehen. Die gelesenen Tags bleiben trotzdem
   gespeichert, damit das zweite Mal Sekunden statt Minuten dauert. */

let loBusy = false;
let loStop = false;

const loPlayable = () => !!LO && LO.songs.length >= Local.MIN;

function loNote(msg) { $('#loStatus').textContent = msg; }

function buildLocalUI() {
  const dir = $('#loDir'), files = $('#loFiles');

  $('#loPickDir').onclick = async () => {
    if (loBusy) return;
    if (!Local.supported()) return dir.click();
    try {
      const handle = await Local.pickDirectory();
      await scanHandle(handle);
    } catch (e) {
      /* Abbrechen im Dateidialog ist kein Fehler. */
      if (e && e.name !== 'AbortError') loNote('Der Ordner ließ sich nicht öffnen.');
    }
  };
  dir.onchange = () => { const f = [...dir.files]; dir.value = ''; if (f.length) scanFiles(f); };
  $('#loPickFiles').onclick = () => files.click();
  files.onchange = () => { const f = [...files.files]; files.value = ''; if (f.length) scanFiles(f, 'Eigene Musik'); };

  $('#loCancel').onclick = () => { loStop = true; loNote('Wird abgebrochen …'); };

  $('#loGrant').onclick = async () => {
    const handle = await Local.getHandle();
    if (!handle) return;
    const st = await Local.permission(handle, true);
    if (st === 'granted') scanHandle(handle);
    else loNote('Ohne Freigabe kann der Ordner nicht gelesen werden.');
  };

  $('#loClear').onclick = () => {
    /* Kam die Mediathek vom Server, waere sie nach dem Neuladen sofort wieder
       da - dann muss auch der gemerkte Zugang weg. */
    if (LO && LO.server) { Server.store(null); $('#srvForget').hidden = true; srvNote(''); }
    LO = null;
    Local.forget();
    Local.dropHandle();
    if (mode === 'local') setMode('charts');
    applyFilters();
    renderLocal();
    loNote('');
  };

  renderLocal();
}

function renderLocal() {
  renderPanelSums();
  $('#loPickDir').hidden = loBusy;
  $('#loPickFiles').hidden = loBusy;
  $('#loCancel').hidden = !loBusy;
  $('#loClear').hidden = loBusy || !LO;
  if (loBusy || LO) $('#loGrant').hidden = true;
  if (!loBusy && LO) {
    loNote(`${LO.name}: ${LO.songs.length} Songs`
      + (loPlayable() ? '' : ` – für eine Runde braucht es ${Local.MIN}`));
  }
  renderModes();
}

async function scanHandle(handle) {
  if (loBusy) return;
  loBusy = true;
  loStop = false;
  renderLocal();
  loNote('Ordner wird durchsucht …');
  let files = [];
  try {
    files = await Local.filesFromHandle(handle, () => loStop);
  } catch (e) {
    loBusy = false;
    renderLocal();
    return loNote('Der Ordner ließ sich nicht lesen.');
  }
  loBusy = false;
  if (!files.length) { renderLocal(); return loNote('In dem Ordner steckt keine Musik.'); }
  await scanFiles(files, handle.name, { handle: true });
}

async function scanFiles(list, name, opts) {
  if (loBusy) return;
  opts = opts || {};
  loBusy = true;
  loStop = false;
  renderLocal();
  loNote(`${list.length} Dateien werden gelesen …`);
  const res = await Local.scan(list, {
    name,
    stop: () => loStop,
    onProgress: (n, t) => loNote(`${n} von ${t} gelesen …`),
  });
  LO = buildPlaylist(res, 'local');
  loBusy = false;
  applyFilters();
  renderLocal();
  if (!LO) return loNote('Keine brauchbare Musikdatei dabei.');
  if (loStop) loNote(`Abgebrochen bei ${LO.songs.length} Songs – sie sind trotzdem da.`);
  /* Beim Wiederherstellen nach dem Neuladen bleibt der Modus, wo er war. */
  if (loPlayable() && mode !== 'local' && (!opts.silent || settings.mode === 'local')) setMode('local');
  else if (mode === 'local') newRound();
}

/* ------------------------------------- Playlist: einzeln hinzufuegen */

/* Eine Playlist muss nicht aus einer Datei kommen. „Loud Rihanna" eintippen,
   Album anklicken, drin - dieselbe iTunes-Suche wie beim Import, nur ohne
   Titelliste davor. */
let plFindKind = 'song';
let plFindTimer = null;
let plFindBusy = false;

function buildPlFindUI() {
  const inp = $('#plFind');
  if (!inp) return;
  $('#plFindKind').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      plFindKind = b.dataset.v;
      $('#plFindKind').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      if (inp.value.trim().length >= 2) runFind(inp.value.trim());
    };
  });
  inp.oninput = () => {
    clearTimeout(plFindTimer);
    const q = inp.value.trim();
    if (q.length < 2) return renderFinds([]);
    plFindTimer = setTimeout(() => runFind(q), 450);
  };
  inp.onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(plFindTimer);
    if (inp.value.trim().length >= 2) runFind(inp.value.trim());
  };
}

async function runFind(q) {
  if (plFindBusy) return;
  plFindBusy = true;
  plFindNote('Wird gesucht …');
  try {
    const hits = await Playlist.find(q, plFindKind);
    renderFinds(hits);
    plFindNote(hits.length ? '' : 'Nichts gefunden.');
  } catch (e) {
    renderFinds([]);
    plFindNote(e && e.throttled ? 'Apple bremst gerade – gleich nochmal.' : 'Die Suche hat nicht geklappt.');
  }
  plFindBusy = false;
}

function plFindNote(msg) { $('#plFindNote').textContent = msg; }

function renderFinds(hits) {
  const box = $('#plHits');
  box.innerHTML = '';
  const drin = new Set((PL ? PL.songs : []).map(songKey));
  hits.slice(0, 20).forEach(h => {
    const alben = plFindKind === 'album';
    const schon = !alben && drin.has(songKey(h));
    const row = el('button', 'arhit' + (schon ? ' on' : ''));
    row.appendChild(el('span', 'nm', h.t + (h.a ? ' – ' + h.a : '')));
    row.appendChild(el('span', 'sub', alben ? `${h.n || '?'} Titel` : (schon ? 'drin' : String(h.y || ''))));
    row.onclick = () => (alben ? addAlbum(h) : addSongs([h], h.t));
    box.appendChild(row);
  });
}

async function addAlbum(album) {
  if (plFindBusy) return;
  plFindBusy = true;
  plFindNote(`${album.t}: Titel werden geholt …`);
  try {
    const songs = await Playlist.albumTracks(album.id);
    plFindBusy = false;
    if (!songs.length) return plFindNote('Von dem Album gibt es keine Hörproben.');
    addSongs(songs, album.t);
  } catch (e) {
    plFindBusy = false;
    plFindNote(e && e.throttled ? 'Apple bremst gerade – gleich nochmal.' : 'Das Album kam nicht durch.');
  }
}

/* Dazugelegt wird zur bestehenden Playlist; Doppelte fallen weg. Gehoert
   die Playlist zu einem Import, kommt es dort als Zugabe dazu - sonst waere
   es beim naechsten Nachziehen wieder weg. */
function addSongs(songs, was) {
  const vorher = PL ? PL.songs.length : 0;
  if (plJob) {
    plJob.extra = Playlist.dedupe([...plJob.extra, ...songs]);
    plSync();
  } else {
    const name = PL ? PL.name : 'Eigene Playlist';
    const alle = Playlist.dedupe([...(PL ? PL.songs : []), ...songs]);
    PL = buildPlaylist({ name, songs: alle });
    Playlist.store({ name, songs: alle });
    applyFilters();
  }
  renderPlaylist();
  renderFinds([]);
  $('#plFind').value = '';
  const neu = (PL ? PL.songs.length : 0) - vorher;
  plFindNote(neu ? `${was}: ${neu} Titel dazu.` : `${was} war schon drin.`);
  if (plPlayable() && mode !== 'playlist') setMode('playlist');
}

/* Beim Start: den gemerkten Ordner wieder oeffnen, wenn der Browser das kann
   und die Freigabe noch steht. */
async function restoreLocal() {
  const last = Local.lastKnown();
  if (!Local.supported()) {
    if (last && last.count) loNote(`Zuletzt: ${last.name} mit ${last.count} Songs – Ordner erneut wählen, dann geht es sofort.`);
    return srvRestore();
  }
  const handle = await Local.getHandle();
  if (!handle) return srvRestore();
  const st = await Local.permission(handle, false);
  if (st === 'granted') {
    const files = await Local.filesFromHandle(handle, () => loStop).catch(() => []);
    if (files.length) await scanFiles(files, handle.name, { silent: true });
  } else {
    $('#loGrant').hidden = false;
    loNote(`${handle.name}${last ? ` mit ${last.count} Songs` : ''}: einmal freigeben, dann ist alles wieder da.`);
    await srvRestore();
  }
}

/* Ein gemerkter Server wird beim Start still wieder geholt - eine Mediathek,
   die man einmal eingetragen hat, soll einfach da sein. */
async function srvRestore() {
  const cfg = Server.restore();
  if (!cfg || !cfg.url || LO) return;
  await loadServer(cfg, { silent: true });
}

/* ------------------------------------------- Eigene Musik vom Server */

/* Subsonic, Jellyfin und Plex haben eine offene Schnittstelle - kein OAuth,
   keine registrierte App -, also geht das auch ohne Backend. Gespielt wird
   dann derselbe Modus, nur dass die Songs nicht aus Dateien kommen, sondern
   von der eigenen Mediathek. Siehe assets/server.js, auch zu den zwei
   Stolpersteinen (https und CORS). */

let srvKind = 'subsonic';
let srvBusy = false;

const srvNote = m => { const n = $('#srvNote'); if (n) n.textContent = m; };

function srvCfg() {
  return {
    kind: srvKind,
    url: $('#srvUrl').value.trim(),
    user: $('#srvUser').value.trim(),
    pass: $('#srvPass').value,
  };
}

function buildServerUI() {
  if (!$('#srvBox')) return;
  $('#srvKind').querySelectorAll('button').forEach(b => {
    b.onclick = () => { srvKind = b.dataset.v; renderServerKind(); };
  });

  const alt = Server.restore();
  if (alt) {
    srvKind = alt.kind || 'subsonic';
    $('#srvUrl').value = alt.url || '';
    $('#srvUser').value = alt.user || '';
    $('#srvPass').value = alt.pass || '';
    $('#srvForget').hidden = false;
  }
  renderServerKind();

  $('#srvGo').onclick = () => loadServer(srvCfg());
  $('#srvForget').onclick = () => {
    Server.store(null);
    $('#srvPass').value = '';
    $('#srvForget').hidden = true;
    srvNote('Zugang vergessen.');
  };
  [$('#srvUrl'), $('#srvUser'), $('#srvPass')].forEach(i => {
    i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); loadServer(srvCfg()); } };
  });
}

/* Plex kennt keinen Benutzernamen, dort zaehlt nur der Token. Und weil kaum
   jemand weiss, wo der steht, sagt es die Zeile darunter. */
const SRV_HINT = {
  subsonic: 'Adresse deines Navidrome, Airsonic oder Gonic, dazu Benutzername '
    + 'und Passwort wie beim Anmelden.',
  jellyfin: 'Adresse deines Jellyfin (oder Emby), Benutzername und Passwort. '
    + 'Statt des Passworts geht auch ein API-Schlüssel – dann das Namensfeld leer lassen. '
    + 'Den Schlüssel gibt es unter Dashboard → Erweitert → API-Schlüssel.',
  plex: 'Adresse: die, unter der du deinen Server erreichst – meist eine auf '
    + '.plex.direct:32400, die app.plex.tv selbst benutzt. Token: in der Plex-Weboberfläche '
    + 'einen Song auswählen, ⋮ → Informationen → XML anzeigen; in der Adresse des neuen '
    + 'Tabs steht am Ende X-Plex-Token=…',
};

function renderServerKind() {
  $('#srvKind').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === srvKind));
  const plex = srvKind === 'plex';
  $('#srvUser').hidden = plex;
  $('#srvPass').placeholder = plex ? 'X-Plex-Token'
    : srvKind === 'jellyfin' ? 'Passwort (oder API-Schlüssel)' : 'Passwort';
  $('#srvHint').textContent = SRV_HINT[srvKind] || '';
}

async function loadServer(cfg, opts) {
  if (srvBusy || loBusy) return;
  opts = opts || {};
  srvBusy = true;
  $('#srvGo').disabled = true;
  srvNote('Verbindung wird geprüft …');
  try {
    const info = await Server.check(cfg);
    srvNote('Songs werden geholt …');
    const list = await Server.tracks(cfg, {
      token: info.token,
      onProgress: n => srvNote(`${n} Songs geholt …`),
    });
    if (!list.length) throw new Error('Der Server gibt keine Songs heraus.');
    LO = buildPlaylist({ name: cfg.name || info.name, songs: list }, 'local');
    LO.server = true;
    if ($('#srvSave').checked) {
      Server.store(cfg);
      $('#srvForget').hidden = false;
    }
    applyFilters();
    srvNote(`${LO.name}: ${LO.songs.length} Songs`);
    renderLocal();
    if (loPlayable() && mode !== 'local' && (!opts.silent || settings.mode === 'local')) setMode('local');
    else if (mode === 'local') newRound();
  } catch (e) {
    srvNote(e && e.message ? e.message : 'Das hat nicht geklappt.');
  }
  srvBusy = false;
  $('#srvGo').disabled = false;
}

/* -------------------------------------------------------------- Spotify */

/* Anmelden, eigene Playlists durchsehen, eine antippen - dann laeuft sie wie
   ein Export durch die Aufloesung. Details und Grenzen in spotify.js. */

let spLists = null;          /* null = noch nicht geholt */
let spBusy = false;
const spNote = m => { $('#spNote').textContent = m; };

function buildSpotifyUI() {
  if (!$('#spBox')) return;
  $('#spRedirect').textContent = Spotify.redirectUri();
  $('#spClient').value = Spotify.clientId();
  $('#spClient').onchange = () => Spotify.setClientId($('#spClient').value);
  $('#spCopy').onclick = () => {
    const ok = () => spNote('Adresse kopiert.');
    if (navigator.clipboard) navigator.clipboard.writeText(Spotify.redirectUri()).then(ok, () => {});
  };
  $('#spLogin').onclick = async () => {
    if (!Spotify.FIXED) Spotify.setClientId($('#spClient').value);
    try { await Spotify.login(); } catch (e) { spNote(e.message); }
  };
  $('#spLogout').onclick = () => {
    Spotify.logout();
    spLists = null;
    renderSpotify();
    spNote('Abgemeldet.');
  };
  $('#spFilter').oninput = () => renderSpotifyLists();
  /* Die Liste wird erst geholt, wenn man hineinschaut. */
  $('#spBox').addEventListener('toggle', () => {
    if ($('#spBox').open && Spotify.loggedIn() && !spLists) loadSpotifyLists();
  });
  renderSpotify();

  /* Zurueck von der Anmeldung? Dann gleich aufklappen und die Playlists
     zeigen - deshalb ist man ja hier. */
  Spotify.callback().then(r => {
    if (!r) return;
    const panel = $('#plPanel');
    panel.open = true;
    $('#spBox').open = true;
    renderSpotify();
    if (!r.ok) return spNote(r.error);
    if (!spLists) loadSpotifyLists();
  }).catch(() => spNote('Die Anmeldung kam nicht durch.'));
}

function renderSpotify() {
  const drin = Spotify.loggedIn();
  $('#spSetup').hidden = drin || Spotify.FIXED;
  $('#spLogin').hidden = drin;
  $('#spLogout').hidden = !drin;
  $('#spFilter').hidden = !drin || !spLists || spLists.length < 8;
  if (!drin) $('#spLists').innerHTML = '';
  else renderSpotifyLists();
}

async function loadSpotifyLists() {
  if (spBusy) return;
  spBusy = true;
  spNote('Playlists werden geholt …');
  try {
    spLists = await Spotify.playlists();
    const u = Spotify.user();
    spNote(`${u ? u.name + ': ' : ''}${spLists.length} Playlists`);
  } catch (e) {
    spLists = null;
    spNote(e.auth ? 'Die Anmeldung ist abgelaufen – bitte neu anmelden.' : e.message);
  }
  spBusy = false;
  renderSpotify();
}

function renderSpotifyLists() {
  const box = $('#spLists');
  box.innerHTML = '';
  if (!spLists) return;
  const n = norm($('#spFilter').value);
  const alle = [{ id: 'liked', name: 'Lieblingssongs', readable: true, count: 0 }, ...spLists];
  alle.filter(p => !n || norm(p.name).includes(n)).forEach(p => {
    const b = el('button', 'arhit');
    b.appendChild(el('span', 'nm', p.name));
    b.appendChild(el('span', 'sub', !p.readable ? 'nicht lesbar'
      : p.count ? `${p.count} Titel` : ''));
    /* Fremde Playlists stehen da, damit niemand seine sucht - antippen
       laesst sich nur, was Spotify auch herausgibt. */
    if (!p.readable) {
      b.disabled = true;
      b.title = `Gehört ${p.owner || 'jemand anderem'} – Spotify gibt die Titel nur für eigene und gemeinsame Playlists heraus.`;
    }
    b.onclick = () => importSpotify(p);
    box.appendChild(b);
  });
}

async function importSpotify(p) {
  if (plBusy || spBusy) return spNote('Erst die laufende Suche anhalten.');
  const max = Playlist.MAX_TRACKS;
  spBusy = true;
  spNote(`${p.name}: Titel werden geholt …`);
  let list = [];
  try {
    list = await Spotify.tracks(p.id, {
      max,
      onProgress: (n, total) => spNote(`${p.name}: ${n} von ${Math.min(total, max)} Titeln geholt …`),
    });
  } catch (e) {
    spBusy = false;
    if (e.auth) { renderSpotify(); return spNote('Die Anmeldung ist abgelaufen – bitte neu anmelden.'); }
    return spNote(e.forbidden ? 'Diese Playlist gibt Spotify nicht heraus – nur eigene und gemeinsame.' : e.message);
  }
  spBusy = false;
  if (!list.length) return spNote(`${p.name} ist leer.`);
  spNote(`${p.name}: ${list.length} Titel${p.count > max ? ` (die ersten ${max})` : ''} – sie werden jetzt bei Apple gesucht.`);
  await startImport(p.name, list);
}

/* ------------------------------------------------------------- Playlist */

const PL_MIN = 5;
/* Kollaborationen: der komplette Kuenstlerstring bleibt eine ID, zusaetzlich
   werden die Beteiligten einzeln aufgenommen. Ein falscher Schnitt kostet hier
   nichts - er faerbt hoechstens einen Tipp gelb, der es sonst nicht waere. */
const SPLIT_ARTIST = /\s*(?:,|&|\/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bx\b|\bvs\.?\b)\s*/i;

function buildPlaylist(pl, kind) {
  if (!pl || !pl.songs || !pl.songs.length) return null;
  const artists = [], byName = new Map();
  const idOf = name => {
    const n = norm(name);
    if (!n) return -1;
    if (!byName.has(n)) { byName.set(n, artists.length); artists.push(name); }
    return byName.get(n);
  };
  const songs = pl.songs.map((raw, i) => {
    const s = { ...raw, i, d: kind || 'playlist' };
    const ids = new Set();
    const add = x => { const id = idOf(x); if (id >= 0) ids.add(id); };
    add(s.a);
    String(s.a || '').split(SPLIT_ARTIST).forEach(add);
    (s.an || []).forEach(add);
    (String(s.t || '').match(/\((?:feat|ft|with)\.?\s+([^)]+)\)/i) || [])[1]?.split(SPLIT_ARTIST).forEach(add);
    s.ar = [...ids];
    s.n = norm(s.t);
    s.na = s.ar.map(a => norm(artists[a])).join(' ');
    return s;
  });
  return { name: pl.name || (kind === 'local' ? 'Eigene Musik' : 'Playlist'),
           artists, songs, missed: pl.missed || [] };
}

const plPlayable = () => !!PL && PL.songs.length >= PL_MIN;

let plBusy = false;       /* Suche laeuft gerade */
let plStop = false;       /* Abbruch angefordert */
let plJob = null;         /* Titelliste des letzten Imports: gefunden, offen, nicht gefunden */
let plWait = 0;           /* so viele Sekunden laesst Apple gerade warten */
let plSyncTimer = null;

/* Ein Titel der Liste, gefunden in songs.json - kostet keine Anfrage. Bei
   Freitext ist offen, welche Haelfte der Titel ist, also beide. */
function localFind(t) {
  const pairs = t.loose && t.artist ? [[t.title, t.artist], [t.artist, t.title]] : [[t.title, t.artist]];
  for (const [titel, wer] of pairs) {
    const s = dbFind(titel, wer);
    if (s) {
      /* `an`: die Beteiligten, die songs.json kennt - sonst waere ein Tipp
         auf DaBaby bei „Levitating" nicht mehr gelb. */
      return { t: s.t, a: s.a, an: s.ar.map(i => DB.artists[i]), al: s.al || '', y: s.y || 0,
               g: s.g || '', s: 0, p: s.p, c: s.c || '', id: s.k || undefined, k: s.k || undefined };
    }
  }
  return null;
}

/* Die Playlist eines Auftrags: Gefundenes in der Reihenfolge der Liste,
   dazu, was von Hand dazugelegt wurde. */
function jobSongs(j) {
  const out = [];
  j.tracks.forEach(t => { const f = j.found.get(t.key); if (f) out.push(f.song); });
  return Playlist.dedupe([...out, ...j.extra]);
}

/* Die Playlist aus dem Auftrag nachziehen - waehrend der Suche laufend,
   damit man mit dem schon Gefundenen spielen kann. Eine alte Playlist bleibt
   stehen, bis die neue fuer eine Runde reicht; sonst waere der Modus in den
   ersten Sekunden einer neuen Suche gesperrt. */
function plSync() {
  clearTimeout(plSyncTimer);
  plSyncTimer = null;
  const j = plJob;
  if (!j) return;
  const songs = jobSongs(j);
  const war = plPlayable();
  if (j.own || songs.length >= PL_MIN || !PL) {
    j.own = true;
    PL = buildPlaylist({ name: j.name, songs });
    Playlist.store(PL ? { name: j.name, songs } : null);
  }
  Playlist.storeQueue(j);
  if (mode === 'playlist') applyFilters();
  else plFiltered = PL ? unblocked(Filters.apply(PL.songs, settings.plFilters, PL)) : [];
  renderModes();
  /* Gewechselt wird nur, solange in der laufenden Runde nichts passiert ist -
     mitten aus einer Runde heraus waere es ein Aufgeben. Sonst ist der Knopf
     jetzt frei, und die Zeile darunter sagt es. */
  if (!war && plPlayable() && mode !== 'playlist' && roundUntouched()) setMode('playlist');
  plShow();
  renderImport();
}
const plSoon = () => { if (!plSyncTimer) plSyncTimer = setTimeout(plSync, 250); };

function buildPlaylistUI() {
  const file = $('#plFile');
  $('#plPick').onclick = () => file.click();
  file.onchange = () => {
    const f = file.files && file.files[0];
    if (f) readPlaylistFile(f);
    file.value = '';
  };

  $('#plPasteToggle').onclick = () => {
    const box = $('#plPaste'), go = $('#plPasteGo');
    box.hidden = !box.hidden;
    go.hidden = box.hidden;
    if (!box.hidden) box.focus();
  };
  $('#plPasteGo').onclick = () => {
    const box = $('#plPaste');
    if (box.value.trim()) loadPlaylistText(box.value, 'Eingefügte Liste');
  };

  $('#plCancel').onclick = () => { plStop = true; plNote('Wird angehalten …'); };
  $('#plResume').onclick = () => { if (plJob) runResolve(plJob); };
  $('#plView').onclick = () => openImport();

  $('#plClear').onclick = () => {
    if (plBusy) return;
    PL = null;
    plJob = null;
    Playlist.store(null);
    Playlist.storeQueue(null);
    if (mode === 'playlist') setMode('charts');
    applyFilters();
    renderPlaylist();
  };

  $('#modeSeg').querySelectorAll('button').forEach(b => {
    b.onclick = () => setMode(b.dataset.v);
  });
  $('#pickPrev').onclick = () => stepPick(-1);
  $('#pickNext').onclick = () => stepPick(1);

  /* Datei irgendwo aufs Fenster ziehen reicht. */
  document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const dt = e.dataTransfer;
    if (!dt) return;
    /* Nach dem ersten await ist dataTransfer leer - also jetzt alles holen. */
    const erste = dt.files && dt.files[0];
    const musik = await Local.fromDrop(dt);
    if (musik.length) return scanFiles(musik);
    if (erste) readPlaylistFile(erste);
  });

  renderPlaylist();
}

function readPlaylistFile(f) {
  if (!/\.(csv|tsv|txt|json|m3u|m3u8)$/i.test(f.name) && !/^text\/|json/.test(f.type || '')) {
    return plNote('Das ist keine Textdatei – CSV, TSV, TXT oder JSON wird gebraucht.');
  }
  if (f.size > 4e6) return plNote('Datei ist zu groß.');
  const rd = new FileReader();
  rd.onload = () => loadPlaylistText(String(rd.result || ''), f.name.replace(/\.[a-z0-9]+$/i, ''));
  rd.readAsText(f);
}

async function loadPlaylistText(text, name) {
  const parsed = Playlist.parse(text);
  if (!parsed.tracks.length) return plNote(parsed.note || 'Keine Titel in der Datei gefunden.');
  await startImport(name, parsed.tracks);
}

/* Eine neue Liste - aus einer Datei, eingefuegt oder von Spotify. */
async function startImport(name, tracks) {
  if (plBusy) return plNote('Erst die laufende Suche anhalten.');
  await runResolve(Playlist.job(name, tracks));
}

/* Ein Lauf ueber den Auftrag. Was schon im Cache oder in songs.json steht,
   geht ohne Anfrage durch - ein zweiter Lauf macht also genau dort weiter,
   wo der erste aufgehoert hat. */
async function runResolve(j) {
  if (plBusy || !j) return;
  plBusy = true;
  plStop = false;
  plWait = 0;
  plJob = j;
  Playlist.storeQueue(j);
  renderPlaylist();

  const res = await Playlist.run(j, {
    cancelled: () => plStop,
    local: localFind,
    onFound: plSoon,
    onProgress: () => { plWait = 0; plShow(); },
    onWait: secs => { plWait = secs; plShow(); },
  });

  plBusy = false;
  plWait = 0;
  plSync();
  renderPlaylist();
  renderImport();

  const total = j.tracks.length, f = j.found.size;
  if (res.throttled) plNote(`${f} von ${total} gefunden – Apple bremst. Später auf „Weiter suchen“ tippen.`);
  else if (!res.complete) plNote(`Angehalten bei ${total - j.pending.length} von ${total} – „Weiter suchen“ macht dort weiter.`);
  else if (!f) plNote('Kein einziger Titel gefunden. Stimmen Titel- und Künstlerspalte?');
  else if (!plPlayable()) plNote(`Nur ${f} von ${total} Titeln gefunden – für eine Runde braucht es ${PL_MIN}.`);
}

function plNote(msg) { $('#plStatus').textContent = msg; }

/* Der Fortschritt bleibt stehen, auch wenn Apple bremst - die Wartezeit
   steht darunter, statt ihn zu verdraengen. */
function plShow() {
  const j = plJob, lauf = plBusy && !!j;
  $('#plBar').hidden = !lauf;
  $('#plSub').hidden = !lauf;
  if (lauf) {
    const total = j.tracks.length, f = j.found.size, m = j.missed.size;
    fillBar($('#plBar'), f, m, total);
    plNote(`${f + m} von ${total} durchsucht · ${f} gefunden` + (m ? ` · ${m} nicht` : ''));
    $('#plSub').textContent = plWait ? `Apple bremst – weiter in ${plWait} s`
      : plPlayable() && j.own ? 'Schon spielbar – der Rest kommt beim Spielen dazu.'
      : `Ab ${PL_MIN} gefundenen Songs geht es los.`;
  }
  renderPanelSums();
}

function fillBar(bar, f, m, total) {
  bar.querySelector('.ok').style.width = (total ? f / total * 100 : 0) + '%';
  bar.querySelector('.no').style.width = (total ? m / total * 100 : 0) + '%';
}

/* Welcher Modus ueberhaupt zur Wahl steht, haengt am Bestand: ohne Playlist
   keine Playlist, ohne geladenen Kuenstler kein Kuenstlermodus. */
function renderModes() {
  /* Bei einer Preview meint "Anfang" den Anfang des 30-Sekunden-Ausschnitts,
     bei einer eigenen Datei den Anfang des Songs - das ist ein Unterschied,
     also steht es auch anders da. */
  const eigen = mode === 'local';
  const hook = $('#startMode [data-v="hook"]');
  if (hook) hook.textContent = eigen ? 'Anfang des Songs' : 'Anfang des Ausschnitts';
  $('#modeSeg').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === mode);
    b.disabled = (b.dataset.v === 'playlist' && !plPlayable())
      || (b.dataset.v === 'local' && !loPlayable())
      || (PICKED.includes(b.dataset.v) && !listFor(b.dataset.v).length);
  });
}

function renderPlaylist() {
  renderModes();
  renderPanelSums();
  if ($('#arHits')) renderArtists();
  const offen = plJob ? plJob.pending.length : 0;
  const fehlt = plJob ? plJob.missed.size : 0;
  $('#plPick').disabled = plBusy;
  $('#plPick').hidden = plBusy;
  $('#plPasteToggle').hidden = plBusy;
  $('#plCancel').hidden = !plBusy;
  $('#plResume').hidden = plBusy || !offen;
  $('#plResume').textContent = `Weiter suchen (${offen} offen)`;
  $('#plView').hidden = !plJob;
  $('#plView').textContent = 'Titelliste ansehen' + (fehlt ? ` · ${fehlt} fehlen` : '');
  $('#plClear').hidden = plBusy || (!PL && !plJob);
  $('#plPaste').hidden = true;
  $('#plPasteGo').hidden = true;

  plShow();
  if (plBusy) return;
  if (!PL) return plNote(fehlt ? 'Nichts gefunden – in der Titelliste lässt sich jeder Titel selbst suchen.' : '');
  plNote(`${PL.name}: ${PL.songs.length} Songs`
    + (fehlt ? ` · ${fehlt} nicht gefunden` : '') + (offen ? ` · ${offen} offen` : ''));
}

function setMode(m) {
  if (m === mode) return;
  if (m === 'playlist' && !plPlayable()) return;
  if (m === 'local' && !loPlayable()) return;
  if (PICKED.includes(m) && !listFor(m).length) return;
  mode = m;
  settings.mode = m;
  save('settings', settings);
  Audio2.stop();
  $('#reveal').hidden = true;
  $('#summary').hidden = true;
  hideSuggest();
  pick = null;
  $('#search').value = '';
  $('#clearPick').hidden = true;
  applyFilters();      /* erst der Pool: ein kleines Jahrzehnt spielt ohne */
  renderPlaylist();    /* Stufen, und das entscheidet newRound() */
  newRound();
}

/* ------------------------------------------------------------------ Konfetti */

function burst() {
  const c = $('#confetti'), x = c.getContext('2d');
  c.width = innerWidth; c.height = innerHeight;
  const colors = ['#3ee07a', '#e8c33c', '#a98bf5', '#ffffff'];
  const p = Array.from({ length: 110 }, () => ({
    x: innerWidth / 2, y: innerHeight / 2,
    vx: (Math.random() - .5) * 17, vy: (Math.random() - .7) * 16,
    s: 3 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)],
    r: Math.random() * 6, vr: (Math.random() - .5) * .3, life: 1,
  }));
  let t = 0;
  (function frame() {
    x.clearRect(0, 0, c.width, c.height);
    t++;
    p.forEach(o => {
      o.vy += .42; o.vx *= .99; o.x += o.vx; o.y += o.vy; o.r += o.vr; o.life -= .009;
      x.save(); x.translate(o.x, o.y); x.rotate(o.r);
      x.globalAlpha = Math.max(0, o.life); x.fillStyle = o.c;
      x.fillRect(-o.s / 2, -o.s / 2, o.s, o.s * 1.6);
      x.restore();
    });
    if (t < 130) requestAnimationFrame(frame);
    else x.clearRect(0, 0, c.width, c.height);
  })();
}

boot();
