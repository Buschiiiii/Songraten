/* Audio-Engine: laedt die 30s-Preview komplett, dekodiert sie und spielt
   exakte Ausschnitte ab. Ueber ein <audio>-Element waere 0,01s nicht machbar,
   weil Seek- und Netzwerklatenz groesser sind als der Ausschnitt selbst. */

const Audio2 = (() => {
  let ctx = null;
  let gain = null;
  let current = null;
  const cache = new Map();
  let volume = 0.8;

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* iOS gibt Ton nur frei, wenn der Context in einer echten Nutzergeste
     aufgeweckt und einmal etwas abgespielt wurde - deshalb der stumme
     Ein-Sample-Puffer. Ohne audioSession.type = 'playback' schaltet Safari
     den Ton ausserdem mit dem Klingelschalter stumm. */
  function unlock() {
    const c = ensure();
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch (e) {}
    return c;
  }

  /* Solange der Context nicht laeuft, wird bei jeder Geste neu versucht. */
  ['pointerdown', 'touchend', 'keydown'].forEach(ev =>
    document.addEventListener(ev, () => { if (!ctx || ctx.state !== 'running') unlock(); }, { capture: true, passive: true }));

  /* Safari kennt decodeAudioData lange nur mit Rueckruf. */
  function decode(c, buf) {
    return new Promise((res, rej) => {
      const p = c.decodeAudioData(buf, res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }

  async function load(url) {
    if (cache.has(url)) return cache.get(url);
    const p = (async () => {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = await res.arrayBuffer();
      return await decode(ensure(), buf);
    })();
    cache.set(url, p);
    p.catch(() => cache.delete(url));
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
    const out = ensure().createBuffer(full.numberOfChannels, len, rate);
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

  async function loadFile(file, opts) {
    opts = opts || {};
    const seconds = opts.seconds || 20;
    const buf = await file.arrayBuffer();
    const full = await decode(ensure(), buf);
    const start = opts.start === 'random' ? randomStart(full, seconds) : firstSound(full);
    return { buffer: excerpt(full, start, seconds), start, duration: full.duration || 0 };
  }

  function stop() {
    if (current) {
      try { current.stop(); } catch (e) {}
      current = null;
    }
  }

  /* Spielt ab Sekunde `offset` genau `seconds` lang.
     Winzige Rampen an den Kanten, sonst knackt es bei harten Schnitten. */
  function play(buffer, offset, seconds, onEnd) {
    ensure();
    stop();
    const dur = Math.min(seconds, Math.max(0, buffer.duration - offset));
    const ramp = Math.min(0.004, dur / 4);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const env = ctx.createGain();
    const t0 = ctx.currentTime + 0.02;
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(1, t0 + ramp);
    env.gain.setValueAtTime(1, t0 + dur - ramp);
    env.gain.linearRampToValueAtTime(0, t0 + dur);
    src.connect(env);
    env.connect(gain);
    src.start(t0, offset, dur);
    src.stop(t0 + dur + 0.01);
    current = src;
    src.onended = () => { if (current === src) current = null; if (onEnd) onEnd(); };
    return dur;
  }

  function setVolume(v) {
    volume = v;
    if (gain) gain.gain.value = v;
  }

  function warm(url) { load(url).catch(() => {}); }

  return { load, loadFile, excerpt, firstSound, play, stop, setVolume, warm, ensure, unlock,
           state: () => (ctx ? ctx.state : 'none') };
})();
