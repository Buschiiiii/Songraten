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

  return { load, play, stop, setVolume, warm, ensure, unlock, state: () => (ctx ? ctx.state : 'none') };
})();
