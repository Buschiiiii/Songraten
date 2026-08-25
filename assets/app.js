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
/* Im Playlist-Modus gibt es keine Schwierigkeitsstufen, sondern fuenf
   zufaellige Songs aus der eigenen Liste - alle mit demselben Faktor. */
const PL_SLOTS = [1, 2, 3, 4, 5].map(n => ({ id: 'pl' + n, label: 'Song ' + n, short: String(n), mult: 1.0 }));

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

let DB = null;            /* { artists:[], songs:[] } */
let PL = null;            /* aufgeloeste Playlist, gleiche Form wie DB */
let mode = 'charts';      /* 'charts' | 'playlist' */
let byTier = {};
let filtered = [];        /* Songs, die nach den Filtern uebrig bleiben */
let filterMode = 'nur';   /* Wirkung, die ein Klick in den Listen bekommt */
let round = [];           /* 5 Songstaende */
let active = 0;
let settings = load('settings', {
  stages: [true, true, true, true, true, true], start: 'hook', volume: 0.8, mode: 'charts',
  filters: Filters.DEFAULT.map(r => ({ ...r })),
});
let stats = load('stats', { rounds: 0, solved: 0, played: 0, best: 0, byTier: {} });
let recent = load('recent', []);
let pick = null;          /* aktuell im Suchfeld gewaehlter Song */
let sugAll = [];          /* alle Treffer der aktuellen Eingabe */
let sugItems = [];        /* davon schon gezeichnet */
let sugIdx = -1;
const SUG_PAGE = 12;      /* so viele kommen pro Nachladen dazu */

function load(k, d) { try { return { ...d, ...JSON.parse(localStorage.getItem('songrate:' + k) || '{}') }; } catch (e) { return d; } }
function loadArr(k) { try { return JSON.parse(localStorage.getItem('songrate:' + k) || '[]'); } catch (e) { return []; } }
function save(k, v) { try { localStorage.setItem('songrate:' + k, JSON.stringify(v)); } catch (e) {} }
recent = loadArr('recent');

const norm = s => (s || '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const enabledStages = () => STAGES.filter((_, i) => settings.stages[i]);
const slots = () => (mode === 'playlist' ? PL_SLOTS : TIERS);
const pool = () => (mode === 'playlist' && PL ? PL : DB);

/* ---------------------------------------------------------------- Start */

async function boot() {
  const res = await fetch('data/songs.json');
  DB = await res.json();
  DB.songs.forEach((s, i) => {
    s.i = i;
    s.n = norm(s.t);
    s.na = s.ar.map(a => norm(DB.artists[a])).join(' ');
  });
  applyFilters();
  PL = buildPlaylist(Playlist.restore());
  plQueue = Playlist.restoreQueue();
  if (plPlayable() && settings.mode === 'playlist') mode = 'playlist';
  buildChrome();
  newRound();
  $('#boot').remove();
  $('#app').hidden = false;
}

/* ------------------------------------------------------------- Oberflaeche */

function buildChrome() {
  renderSlots();

  const chips = $('#stageChips');
  STAGES.forEach((s, i) => {
    const c = el('button', 'chip', s < 1 ? s + 's' : s + 's');
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
      round.forEach(r => {
        if (r.status === 'playing' && !r.guesses.length && r.stage === 0) r.offset = newOffset();
      });
      focusSearch();
    };
    b.classList.toggle('on', b.dataset.v === settings.start);
  });

  const vol = $('#volume');
  vol.value = Math.round(settings.volume * 100);
  Audio2.setVolume(settings.volume);
  vol.oninput = () => {
    settings.volume = vol.value / 100;
    Audio2.setVolume(settings.volume);
    save('settings', settings);
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
      switchTo((active + (e.key === 'ArrowRight' ? 1 : -1) + slots().length) % slots().length);
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
    if (e.target.tagName === 'INPUT') return;
    if (!$('#reveal').hidden || !$('#summary').hidden) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (!$('#reveal').hidden ? $('#revealNext') : $('#summaryNext')).click(); }
      return;
    }
    if (e.key === ' ') { e.preventDefault(); playCurrent(); }
    else if (e.key.toLowerCase() === 's') submit();
    else if (e.key.toLowerCase() === 'r') newRound();
    else if (/^[1-5]$/.test(e.key)) switchTo(+e.key - 1);
  });

  document.addEventListener('click', e => {
    /* Ein Klick auf einen Knopf, der sich dabei selbst aus dem DOM nimmt,
       ist kein Klick daneben - sonst schliesst „weitere" die Liste. */
    if (!e.target.isConnected) return;
    if (!e.target.closest('.guess-row')) hideSuggest();
  });

  buildPlaylistUI();
  buildFilterUI();
  renderStats();
}

/* Die Leiste links und die Reiter oben zeigen je nach Modus die
   Schwierigkeitsstufen oder die fuenf Playlist-Plaetze. */
function renderSlots() {
  const list = $('#tierList'), tabs = $('#tabs');
  list.innerHTML = '';
  tabs.innerHTML = '';
  slots().forEach((t, i) => {
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
}

/* ----------------------------------------------------------------- Runde */

/* Ist eine Stufe durch die Filter leer, wird aus dem restlichen Pool
   gezogen - lieber eine spielbare Runde als eine leere Kachel. Die Warnung
   in der Songauswahl sagt vorher, dass das passiert. */
function drawSong(tier, used) {
  let pool = (byTier[tier] || []).filter(s => !used.has(s.i));
  if (!pool.length) pool = filtered.filter(s => !used.has(s.i));
  if (!pool.length) return null;
  const fresh = pool.filter(s => !recent.includes(s.i));
  const arr = fresh.length > 20 ? fresh : pool;
  return arr[Math.floor(Math.random() * arr.length)];
}

function drawPlaylist() {
  const src = PL ? PL.songs.slice() : [];
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
  const picked = mode === 'playlist' ? drawPlaylist() : null;
  const used = new Set();
  round = slots().map((t, idx) => {
    const song = picked ? picked[idx % Math.max(1, picked.length)] : drawSong(t.id, used);
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
  if (mode === 'charts') {
    recent = [...round.map(r => r.song && r.song.i).filter(x => x != null), ...recent].slice(0, RECENT_MAX);
    save('recent', recent);
  }
  active = 0;
  render();
  resetBar();
  focusSearch();
  round.forEach((r, i) => preload(i));
}

async function preload(i) {
  const r = round[i];
  if (!r.song || r.buffer) return;
  try {
    r.buffer = await Audio2.load(r.song.p);
  } catch (e) {
    r.error = true;
  }
  if (i === active) render();
}

function switchTo(i) {
  if (i === active) return;
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
  if (!ov || segs.length !== STAGES.length) return;

  const stops = STAGES.map((t, i) => ({ t, x: segs[i].offsetLeft + segs[i].offsetWidth }));
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
  out.sort((a, b) => b[0] - a[0] || b[1].s - a[1].s || a[1].t.localeCompare(b[1].t));

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

function setAction() {
  const b = $('#actionBtn');
  b.classList.toggle('skip', !pick);
  b.querySelector('.txt').textContent = pick ? 'Raten' : 'Überspringen';
}

/* ------------------------------------------------------------- Rateversuch */

function submit() {
  const r = round[active];
  if (!r || !r.song || r.status !== 'playing') return;
  const target = r.song;
  const guess = pick;

  if (guess) {
    const correct = guess.i === target.i ||
      (norm(guess.t) === norm(target.t) && guess.ar.some(a => target.ar.includes(a)));
    const artist = !correct && guess.ar.some(a => target.ar.includes(a));
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
  finish(r, false);
}

function finish(r, won) {
  Audio2.stop();
  clearPick();
  stats.played++;
  if (won) stats.solved++;
  const key = mode === 'playlist' ? 'playlist' : r.tier.id;
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

function showReveal(r, won) {
  const s = r.song;
  revealed = r;
  $('#revealArt').src = s.c.replace('100x100bb', '400x400bb');
  $('#revealTitle').textContent = s.t;
  $('#revealArtist').textContent = s.a;
  $('#revealMeta').textContent = [s.al, s.y || null,
    s.s ? (s.s / 1e9 >= 1 ? (s.s / 1e9).toFixed(2) + ' Mrd. Streams' : Math.round(s.s / 1e6) + ' Mio. Streams') : (s.g || null),
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
  const last = round.every(x => x.status !== 'playing');
  $('#revealNext').textContent = last ? 'Ergebnis' : 'Weiter';
  $('#reveal').hidden = false;
  playFull(r);
}

/* Nach der Aufloesung laeuft der Ausschnitt in voller Laenge, damit man hoert,
   was man da eigentlich hatte. Klick aufs Cover spielt ihn nochmal. */
function playFull(r) {
  if (r && r.buffer) Audio2.play(r.buffer, 0, r.buffer.duration);
}

function closeReveal() {
  Audio2.stop();
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
    row.appendChild(el('span', 's-pts', r.status === 'won' ? '+' + r.points : '—'));
    list.appendChild(row);
  });
  $('#summaryScore').textContent = total;
  stats.rounds++;
  if (total > stats.best) stats.best = total;
  save('stats', stats);
  renderStats();
  $('#summary').hidden = false;
}

/* ------------------------------------------------------------- Rendering */

function render() {
  const r = round[active];
  const stages = enabledStages();

  $('#tierList').querySelectorAll('.tier-item').forEach((b, i) => {
    b.setAttribute('aria-current', i === active);
    const d = b.querySelector('.dot');
    d.className = 'dot' + (round[i] ? (round[i].status === 'won' ? ' won' : round[i].status === 'lost' ? ' lost' : '') : '');
  });
  $('#tabs').querySelectorAll('.tab').forEach((b, i) => {
    b.setAttribute('aria-selected', i === active);
    b.classList.toggle('done', round[i] && round[i].status !== 'playing');
  });

  const bar = $('#stageBar');
  bar.querySelectorAll('.stage-seg').forEach(n => n.remove());
  if (!bar.querySelector('.stage-progress')) bar.appendChild(el('div', 'stage-progress'));
  STAGES.forEach((s, i) => {
    const seg = el('div', 'stage-seg');
    seg.style.flex = Math.log10(s * 1000 + 1);
    if (!settings.stages[i]) seg.classList.add('off');
    else {
      const pos = stages.indexOf(s);
      if (r && pos < r.stage) seg.classList.add('filled');
      if (r && pos === r.stage) seg.classList.add('current');
    }
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
    : r && r.error ? 'Song nicht ladbar – R für neue Runde'
    : mode === 'playlist' ? 'Song aus der Playlist suchen …' : 'Song suchen …';
  $('#roundScore').textContent = round.reduce((a, b) => a + b.points, 0);
  setAction();
}

function renderStats() {
  const d = $('#stats');
  d.innerHTML = '';
  const rate = stats.played ? Math.round(stats.solved / stats.played * 100) : 0;
  const rows = [['Runden', stats.rounds], ['Songs erraten', `${stats.solved}/${stats.played}`], ['Quote', rate + ' %'], ['Bestes Ergebnis', stats.best]];
  rows.forEach(([k, v]) => { d.appendChild(el('dt', null, k)); d.appendChild(el('dd', null, v)); });
}

/* --------------------------------------------------------- Songauswahl */

/* Der Pool wird neu gerechnet, die laufende Runde aber nicht angefasst -
   sonst waere ein Klick auf einen Filter dasselbe wie Aufgeben. */
function applyFilters() {
  filtered = Filters.apply(DB.songs, settings.filters, DB);
  TIERS.forEach(t => byTier[t.id] = filtered.filter(s => s.d === t.id));
  if ($('#fArtist')) renderArtistHits($('#fArtist').value);
  renderFilters();
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
    settings.filters = settings.filters.filter(r => r.type !== 'instrumental');
    if ($('#fInst').checked) settings.filters.push({ mode: 'ohne', type: 'instrumental', value: '', text: 'Instrumental' });
    save('settings', settings);
    applyFilters();
  };

  $('#fReset').onclick = () => {
    settings.filters = Filters.DEFAULT.map(r => ({ ...r }));
    save('settings', settings);
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
  const cnt = Filters.counts(type, DB);
  Filters.options(type, DB).forEach(o => box.appendChild(optionRow(type, o, cnt.get(o.value) || 0)));
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
  const cnt = Filters.counts('artist', DB);
  const n = norm(q);
  const opts = Filters.options('artist', DB);
  const hits = (n
    ? opts.filter(o => o.value.includes(n))
        .sort((a, b) => (a.value.startsWith(n) ? 0 : 1) - (b.value.startsWith(n) ? 0 : 1)
          || (cnt.get(b.value) || 0) - (cnt.get(a.value) || 0))
    : settings.filters.filter(r => r.type === 'artist').map(r => ({ value: r.value, text: r.text }))
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
  const idx = settings.filters.findIndex(r => r.type === type && String(r.value) === String(o.value));
  const had = idx >= 0 ? settings.filters[idx] : null;
  if (idx >= 0) settings.filters.splice(idx, 1);
  if (!had || had.mode !== filterMode) {
    settings.filters.push({ mode: filterMode, type, value: o.value, text: o.text });
  }
  save('settings', settings);
  applyFilters();
}

function removeFilter(i) {
  settings.filters.splice(i, 1);
  save('settings', settings);
  applyFilters();
}

/* Haekchen und Farbe der Zeilen an die aktiven Regeln angleichen. */
function markRules() {
  document.querySelectorAll('.fopt').forEach(row => {
    const r = settings.filters.find(x => x.type === row.dataset.type && String(x.value) === row.dataset.value);
    row.classList.toggle('on', !!r);
    ['nur', 'ohne', 'dazu'].forEach(m => row.classList.toggle(m, !!r && r.mode === m));
  });
  [['#gGenre', 'genre'], ['#gDecade', 'decade'], ['#gArtist', 'artist']].forEach(([sel, type]) => {
    const n = settings.filters.filter(r => r.type === type).length;
    $(sel).querySelector('.fcount').textContent = n ? ` · ${n}` : '';
  });
}

function renderFilters() {
  $('#filterPanel').hidden = mode === 'playlist';

  const box = $('#filterList');
  box.innerHTML = '';
  settings.filters.forEach((r, i) => {
    const chip = el('div', 'frule ' + r.mode);
    chip.appendChild(el('span', null, Filters.label(r)));
    const x = el('button', null, '×');
    x.title = 'Filter entfernen';
    x.onclick = () => removeFilter(i);
    chip.appendChild(x);
    box.appendChild(chip);
  });
  $('#fReset').hidden = !settings.filters.length;
  $('#fInst').checked = settings.filters.some(r => r.type === 'instrumental' && r.mode === 'ohne');
  markRules();

  const n = filtered.length;
  const empty = TIERS.filter(t => !(byTier[t.id] || []).length).map(t => t.label);
  const c = $('#filterCount');
  let warn = true, msg;
  if (!n) msg = 'Kein Song passt zu den Filtern.';
  else if (n < Filters.MIN_POOL) msg = `Nur ${n} Songs übrig – das wird schnell vorhersehbar.`;
  else if (empty.length) msg = `${n} Songs · leer: ${empty.join(', ')} – dort kommt Ersatz aus dem Rest.`;
  else { msg = `${n} Songs im Pool`; warn = false; }
  c.textContent = msg;
  c.classList.toggle('warn', warn);
}

/* ------------------------------------------------------------- Playlist */

const PL_MIN = 5;
/* Kollaborationen: der komplette Kuenstlerstring bleibt eine ID, zusaetzlich
   werden die Beteiligten einzeln aufgenommen. Ein falscher Schnitt kostet hier
   nichts - er faerbt hoechstens einen Tipp gelb, der es sonst nicht waere. */
const SPLIT_ARTIST = /\s*(?:,|&|\/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\bx\b|\bvs\.?\b)\s*/i;

function buildPlaylist(pl) {
  if (!pl || !pl.songs || !pl.songs.length) return null;
  const artists = [], byName = new Map();
  const idOf = name => {
    const n = norm(name);
    if (!n) return -1;
    if (!byName.has(n)) { byName.set(n, artists.length); artists.push(name); }
    return byName.get(n);
  };
  const songs = pl.songs.map((raw, i) => {
    const s = { ...raw, i, d: 'playlist' };
    const ids = new Set();
    const add = x => { const id = idOf(x); if (id >= 0) ids.add(id); };
    add(s.a);
    String(s.a || '').split(SPLIT_ARTIST).forEach(add);
    (String(s.t || '').match(/\((?:feat|ft|with)\.?\s+([^)]+)\)/i) || [])[1]?.split(SPLIT_ARTIST).forEach(add);
    s.ar = [...ids];
    s.n = norm(s.t);
    s.na = s.ar.map(a => norm(artists[a])).join(' ');
    return s;
  });
  return { name: pl.name || 'Playlist', artists, songs, missed: pl.missed || [] };
}

const plPlayable = () => !!PL && PL.songs.length >= PL_MIN;

let plBusy = false;       /* Suche laeuft gerade */
let plStop = false;       /* Abbruch angefordert */
let plQueue = null;       /* eingelesene Liste, solange sie nicht fertig ist */

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

  $('#plCancel').onclick = () => { plStop = true; plNote('Wird abgebrochen …'); };
  $('#plResume').onclick = () => { if (plQueue) runResolve(plQueue.name, plQueue.tracks); };

  $('#plClear').onclick = () => {
    PL = null;
    plQueue = null;
    Playlist.store(null);
    Playlist.storeQueue(null, null);
    if (mode === 'playlist') setMode('charts');
    renderPlaylist();
  };

  $('#modeSeg').querySelectorAll('button').forEach(b => {
    b.onclick = () => setMode(b.dataset.v);
  });

  /* Datei irgendwo aufs Fenster ziehen reicht. */
  document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readPlaylistFile(f);
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
  if (plBusy) return;
  const parsed = Playlist.parse(text);
  if (!parsed.tracks.length) return plNote(parsed.note || 'Keine Titel in der Datei gefunden.');
  plQueue = { name, tracks: parsed.tracks };
  Playlist.storeQueue(name, parsed.tracks);
  await runResolve(name, parsed.tracks);
}

/* Ein Lauf ueber die Titelliste. Was schon im Cache liegt, geht ohne Anfrage
   durch - deshalb macht ein zweiter Lauf genau dort weiter, wo der erste
   aufgehoert hat. */
async function runResolve(name, tracks) {
  if (plBusy) return;
  plBusy = true;
  plStop = false;
  renderPlaylist();
  plNote(`Titel werden gesucht … 0/${tracks.length}`);

  const res = await Playlist.resolve(tracks, {
    cancelled: () => plStop,
    onProgress: (done, total) => plNote(`Titel werden gesucht … ${done}/${total}`),
    onWait: secs => plNote(`Apple bremst – weiter in ${secs} s`),
  });

  plBusy = false;
  const raw = { name, songs: res.songs, missed: res.missed };
  PL = buildPlaylist(raw);
  Playlist.store(PL ? raw : null);

  const complete = !res.throttled && res.done >= res.total;
  if (complete) { plQueue = null; Playlist.storeQueue(null, null); }
  else plQueue = { name, tracks };

  if (plPlayable() && mode !== 'playlist') setMode('playlist');
  renderPlaylist();

  if (res.throttled) plNote(`${res.songs.length} von ${res.total} gefunden – Apple bremst. Später auf „Weiter suchen“ tippen.`);
  else if (!complete) plNote(`Abgebrochen bei ${res.done} von ${res.total} – „Weiter suchen“ macht dort weiter.`);
  else if (!PL) plNote('Kein einziger Titel gefunden. Stimmen Titel- und Künstlerspalte?');
  else if (!plPlayable()) plNote(`Nur ${PL.songs.length} von ${res.total} Titeln gefunden – für eine Runde braucht es ${PL_MIN}.`);
}

function plNote(msg) { $('#plStatus').textContent = msg; }

function renderPlaylist() {
  $('#modeSeg').querySelectorAll('button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === mode);
    b.disabled = b.dataset.v === 'playlist' && !plPlayable();
  });
  $('#plPick').disabled = plBusy;
  $('#plPick').hidden = plBusy;
  $('#plPasteToggle').hidden = plBusy;
  $('#plCancel').hidden = !plBusy;
  $('#plResume').hidden = plBusy || !plQueue;
  $('#plClear').hidden = plBusy || !PL;
  $('#plPaste').hidden = true;
  $('#plPasteGo').hidden = true;
  if (plQueue) $('#plResume').textContent = `Weiter suchen (${plQueue.tracks.length} Titel)`;

  if (plBusy) return;
  if (!PL) return plNote('');
  const miss = PL.missed.length;
  plNote(`${PL.name}: ${PL.songs.length} Songs${miss ? ` · ${miss} nicht gefunden` : ''}`);
  $('#plStatus').title = miss ? PL.missed.slice(0, 40).join('\n') : '';
}

function setMode(m) {
  if (m === mode) return;
  if (m === 'playlist' && !plPlayable()) return;
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
  renderSlots();
  renderPlaylist();
  renderFilters();
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
