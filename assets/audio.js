/* Audio-Engine: laedt die 30s-Preview komplett, dekodiert sie und spielt
   exakte Ausschnitte ab. Ueber ein <audio>-Element waere 0,01s nicht machbar,
   weil Seek- und Netzwerklatenz groesser sind als der Ausschnitt selbst. */

const Audio2 = (() => {
  let ctx = null;
  let gain = null;
  /* Was gerade spielt: eine Wiedergabe aus einem oder mehreren aneinander
     gesetzten Stuecken (extend()). */
  let current = null;   /* { buffer, offset, t0, end, onEnd, env, srcs } */
  /* Eine dekodierte Preview belegt rund 10 MB (30 s Stereo als Float). Ohne
     Grenze waeren nach zwanzig Runden 1 GB belegt, und Safari auf dem iPhone
     wirft den Tab weg. Die Runde haelt ihre fuenf Puffer selbst - der Cache
     muss nur das Doppelte eines Rundenwechsels ueberbruecken. */
  const CACHE_MAX = 12;
  const cache = new Map();
  let volume = 0.8;
  /* Der letzte Fehler, fuer die Erklaerung hinter dem ?-Knopf (app.js). */
  let lastError = null;
  const merk = e => { lastError = e; return e; };

  /* iOS: ohne audioSession.type = 'playback' schaltet der Stummschalter die
     Seite stumm - und zwar so, dass der Context zwar „laeuft", seine Uhr
     aber stehen bleibt (kein onended, kein Ton). Die Art muss gesetzt sein,
     BEVOR der Context entsteht; spaeter umstellen hilft ihm nicht mehr.
     Deshalb hier beim Laden, in ensure() und in unlock(). */
  function session() {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
    } catch (e) {}
  }
  session();

  /* Zum Dekodieren und Schneiden reicht ein OfflineAudioContext - der
     braucht keine Tonausgabe und darf schon beim Laden entstehen. Der
     echte Context kommt erst in der ersten Geste (unlock), wie iOS es will.
     Puffer haengen nicht am Context, der sie dekodiert hat. */
  let off = null;
  function decoder() {
    if (typeof OfflineAudioContext === 'undefined') return ensure();
    if (!off) off = new OfflineAudioContext(1, 1, 44100);
    return off;
  }

  function ensure() {
    if (ctx && ctx.state === 'closed') { ctx = null; gain = null; }
    if (!ctx) {
      session();
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      mark = null;
    }
    /* 'suspended' vor der ersten Geste - und 'interrupted' (nur WebKit):
       nach Anruf, App-Wechsel oder Sperrbildschirm bleibt der Context auf
       dem iPhone darin haengen, und resume() gab es dafuer bisher nicht.
       Alles, was nicht laeuft, wird geweckt; was nicht geht, ist egal. */
    if (ctx.state !== 'running') {
      try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
    return ctx;
  }

  /* iOS gibt Ton nur frei, wenn der Context in einer echten Nutzergeste
     aufgeweckt und einmal etwas abgespielt wurde - deshalb der stumme
     Ein-Sample-Puffer. Ohne audioSession.type = 'playback' schaltet Safari
     den Ton ausserdem mit dem Klingelschalter stumm. */
  /* Wie oft eine Geste den Context nicht zum Laufen gebracht hat. */
  let stuck = 0;

  /* Auf dem iPhone hilft resume() einem 'interrupted' Context oft nicht
     mehr - der bekannte Ausweg ist, ihn in der Geste wegzuwerfen und neu
     anzulegen. Die dekodierten Puffer sind davon unabhaengig. */
  function rebuild() {
    try { if (ctx && ctx.close) ctx.close().catch(() => {}); } catch (e) {}
    ctx = null; gain = null; stuck = 0;
    return ensure();
  }

  /* Steht die Uhr? Nach dem Start merkt sich playNow() Zeit und Stand;
     ist der Context 'running', aber currentTime kommt nicht voran, rendert
     iOS nicht - das ist der stumme Fall ohne jede Fehlermeldung. */
  let mark = null;
  function alive() {
    if (!ctx || !mark || Date.now() - mark.at < 300) return true;
    return ctx.currentTime > mark.t + 0.05;
  }

  function unlock() {
    session();
    let c = ensure();
    if (c.state === 'interrupted' || !alive() || (c.state !== 'running' && ++stuck > 3)) c = rebuild();
    if (c.state === 'running') stuck = 0;
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch (e) {}
    return c;
  }

  /* Solange der Context nicht laeuft, wird bei jeder Geste neu versucht. */
  ['pointerdown', 'touchend', 'keydown', 'click'].forEach(ev =>
    document.addEventListener(ev, () => { if (!ctx || ctx.state !== 'running') unlock(); }, { capture: true, passive: true }));
  /* Zurueck aus dem Hintergrund: wenigstens versuchen; braucht es eine
     Geste, holt sie der naechste Tipp nach. */
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ctx && ctx.state !== 'running') ensure();
  });

  /* Safari kennt decodeAudioData lange nur mit Rueckruf. */
  function decode(c, buf) {
    return new Promise((res, rej) => {
      const p = c.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }

  async function load(url) {
    if (cache.has(url)) {
      /* Zuletzt gebraucht nach hinten, damit es nicht als Erstes faellt. */
      const p = cache.get(url);
      cache.delete(url);
      cache.set(url, p);
      return p;
    }
    const p = (async () => {
      let res;
      try { res = await fetch(url, { mode: 'cors' }); }
      catch (e) { throw merk(Object.assign(new Error('Netzfehler'), { url, net: true, cause: String(e && e.message || e) })); }
      if (!res.ok) throw merk(Object.assign(new Error('HTTP ' + res.status), { url, status: res.status }));
      const buf = await res.arrayBuffer();
      try { return await decode(decoder(), buf); }
      catch (e) {
        throw merk(Object.assign(new Error('Die Hörprobe ließ sich nicht dekodieren.'),
                                 { url, cause: 'decodeAudioData: ' + String(e && (e.message || e.name) || e) }));
      }
    })();
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return p;
  }

  /* ---------------------------------------------------- Lokale Dateien */

  /* Eine lokale Datei ist ein ganzer Song, keine 30-Sekunden-Preview. Fuenf
     davon komplett dekodiert sind schnell ein halbes Gigabyte - eine Minute
     Stereo belegt als Float rund 20 MB. Deshalb wird zwar die ganze Datei
     dekodiert (aus einem Ausschnitt der Rohdatei bekaeme man bei FLAC oder
     AAC nichts Brauchbares heraus), aber sofort auf den gebrauchten
     Ausschnitt zusammengeschnitten. Der grosse Puffer faellt danach weg. */
  function excerpt(full, from, seconds) {
    if (!full || !full.getChannelData) return full;
    const rate = full.sampleRate || 44100;
    const start = Math.max(0, Math.min(from, Math.max(0, full.duration - 0.05)));
    const at = Math.floor(start * rate);
    const len = Math.max(1, Math.min(Math.ceil(seconds * rate), full.length - at));
    const out = decoder().createBuffer(full.numberOfChannels, len, rate);
    for (let ch = 0; ch < full.numberOfChannels; ch++) {
      out.getChannelData(ch).set(full.getChannelData(ch).subarray(at, at + len));
    }
    return out;
  }

  /* Viele Aufnahmen fangen mit Stille an - 0,01 s davon waeren als Raetsel
     eine Zumutung. Also bis zum ersten hoerbaren Ton vorspulen. */
  function firstSound(full) {
    if (!full || !full.getChannelData) return 0;
    const rate = full.sampleRate || 44100;
    const data = full.getChannelData(0);
    const bis = Math.min(data.length, rate * 90);
    for (let i = 0; i < bis; i += 8) {
      if (Math.abs(data[i]) > 0.02) return Math.max(0, i / rate - 0.03);
    }
    return 0;
  }

  /* Zufaellige Stelle, aber nicht im Ausklang und nicht im Vorspann. */
  function randomStart(full, seconds) {
    const dur = full.duration || 0;
    const von = Math.min(dur * 0.1, 30);
    const bis = Math.max(von, dur * 0.85 - seconds);
    return von + Math.random() * Math.max(0, bis - von);
  }

  /* `src` ist eine Datei vom Geraet oder die Adresse eines Songs auf dem
     eigenen Mediathek-Server - beides sind ganze Songs, beides wird gleich
     behandelt. */
  async function loadFile(src, opts) {
    opts = opts || {};
    const seconds = opts.seconds || 20;
    const buf = typeof src === 'string'
      ? await (await fetch(src, { mode: 'cors' })).arrayBuffer()
      : await src.arrayBuffer();
    const full = await decode(decoder(), buf);
    const start = opts.start === 'random' ? randomStart(full, seconds) : firstSound(full);
    return { buffer: excerpt(full, start, seconds), start, duration: full.duration || 0 };
  }

  function stop() {
    if (current) {
      const p = current;
      current = null;
      p.srcs.forEach(src => { try { src.stop(); } catch (e) {} });
    }
  }

  /* Spielt ab Sekunde `offset` genau `seconds` lang.
     Winzige Rampen an den Kanten, sonst knackt es bei harten Schnitten. */
  function play(buffer, offset, seconds, onEnd) {
    try { return playNow(buffer, offset, seconds, onEnd); }
    catch (e) {
      throw merk(Object.assign(new Error('Abspielen ist fehlgeschlagen.'),
                               { cause: String(e && (e.message || e.name) || e) + ' · ' + describe() }));
    }
  }

  function playNow(buffer, offset, seconds, onEnd) {
    ensure();
    stop();
    const dur = Math.min(seconds, Math.max(0, buffer.duration - offset));
    const t0 = ctx.currentTime + 0.02;
    const p = { buffer, offset, t0, end: t0 + dur, onEnd, env: null, srcs: [] };
    piece(p, t0, offset, dur, true);
    mark = { t: ctx.currentTime, at: Date.now() };
    current = p;
    return dur;
  }

  /* Ein Stueck Puffer ab `at` (Kontextzeit), `from` Sekunden im Puffer,
     `len` lang. Ausgeblendet wird immer am Ende, eingeblendet nur am Anfang
     einer Wiedergabe - ein angehaengtes Stueck setzt nahtlos fort. */
  function piece(p, at, from, len, fadeIn) {
    const ramp = Math.min(0.004, len / 4);
    const src = ctx.createBufferSource();
    src.buffer = p.buffer;
    const env = ctx.createGain();
    if (fadeIn) {
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(1, at + ramp);
    } else env.gain.setValueAtTime(1, at);
    env.gain.setValueAtTime(1, at + len - ramp);
    env.gain.linearRampToValueAtTime(0, at + len);
    src.connect(env);
    env.connect(gain);
    src.start(at, from, len);
    src.stop(at + len + 0.01);
    p.srcs.push(src);
    p.env = env;
    /* Fertig ist die Wiedergabe erst mit dem letzten Stueck. */
    src.onended = () => {
      if (p.srcs[p.srcs.length - 1] !== src) return;
      if (current === p) current = null;
      if (p.onEnd) p.onEnd();
    };
  }

  /* Weiterspielen statt neu anfangen (Besitzer, 5. Oktober: „0–10 s laufen,
     bei 5 s ueberspringe ich auf 20 s – dann nicht zurueck auf 0, sondern
     nach 10 einfach weiter"). Laeuft gerade derselbe Ausschnitt, wird das
     Ausblenden am Ende gestrichen und der Rest nahtlos angehaengt. Liefert
     { dur, elapsed } oder null, wenn nichts (mehr) laeuft - dann spielt der
     Aufrufer wie bisher von vorn. */
  function extend(buffer, offset, seconds, onEnd) {
    const p = current;
    if (!p || !ctx || p.buffer !== buffer || p.offset !== offset) return null;
    const now = ctx.currentTime;
    if (now > p.end - 0.03) return null;
    const total = Math.min(seconds, Math.max(0, buffer.duration - offset));
    const sofar = p.end - p.t0;
    const elapsed = Math.max(0, now - p.t0);
    p.onEnd = onEnd;
    if (total - sofar > 0.001) {
      try {
        p.env.gain.cancelScheduledValues(now);
        p.env.gain.setValueAtTime(1, now);
        piece(p, p.end, offset + sofar, total - sofar, false);
      } catch (e) {
        return null;
      }
      p.end = p.t0 + total;
    }
    return { dur: p.end - p.t0, elapsed };
  }

  function setVolume(v) {
    volume = v;
    if (gain) gain.gain.value = v;
  }

  function warm(url) { load(url).catch(() => {}); }

  /* Was der Ton gerade macht - fuer die Meldung, wenn nichts zu hoeren ist. */
  const describe = () => `AudioContext ${ctx ? ctx.state : 'none'}`
    + (ctx && ctx.sampleRate ? `, ${ctx.sampleRate} Hz` : '')
    + (navigator.audioSession ? `, audioSession ${navigator.audioSession.type}` : '')
    + `, Lautstärke ${Math.round(volume * 100)} %`;
  const diag = () => ({ state: ctx ? ctx.state : 'none', clock: alive(), text: describe(), error: lastError, cached: cache.size });

  return { load, loadFile, excerpt, firstSound, play, extend, stop, setVolume, warm, ensure, unlock, rebuild, diag,
           state: () => (ctx ? ctx.state : 'none'), cached: () => cache.size };
})();
