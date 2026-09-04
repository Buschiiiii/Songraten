/* Eigene Mediathek von einem Server: Subsonic (Navidrome, Airsonic, Gonic),
   Jellyfin und Plex.

   Alle drei haben eine offene REST-Schnittstelle - kein OAuth, keine
   registrierte App. Damit geht es ohne Backend, im Gegensatz zu Spotify und
   Apple Music. Was trotzdem stimmen muss:

   1. **Der Server muss über https erreichbar sein.** Diese Seite läuft unter
      https, und ein https-Dokument darf nichts von http nachladen - der
      Browser bricht das ab, ohne zu fragen. Betrifft die typische Adresse im
      Heimnetz (`http://192.168.…`). Abhilfe: Reverse Proxy mit Zertifikat,
      Tailscale, Cloudflare Tunnel - oder bei Plex die `*.plex.direct`-Adresse,
      die genau dafür da ist.
   2. **Der Server muss CORS erlauben.** Navidrome, Jellyfin und Plex tun das
      von Haus aus (`Access-Control-Allow-Origin: *`), ältere Airsonic-
      Versionen nicht immer.

   Beides lässt sich von hier aus nicht erzwingen, deshalb sagt `check()`
   möglichst genau, woran es liegt - „Fehler beim Laden" hilft niemandem.

   Geladen wird nur die Liste, nicht die Musik: gespielt wird ein Song erst,
   wenn er in der Runde steht, und dann als kleines MP3 (Subsonic und Jellyfin
   rechnen das selbst um). Nichts davon verlässt das Gerät in die andere
   Richtung - Zugangsdaten bleiben im localStorage des Browsers. */

const Server = (() => {

  const KINDS = [
    { id: 'subsonic', name: 'Subsonic', note: 'Navidrome, Airsonic, Gonic', pass: true },
    { id: 'jellyfin', name: 'Jellyfin', note: 'auch Emby', pass: true },
    { id: 'plex',     name: 'Plex',     note: 'braucht den X-Plex-Token', pass: false },
  ];

  const MAX = 4000;          /* mehr braucht keine Runde */
  const PAGE = 500;

  const clean = u => String(u || '').trim().replace(/\/+$/, '');

  /* --------------------------------------------------------------- MD5 */
  /* Subsonic will das Passwort als md5(passwort + salt). Eine Bibliothek
     dafuer ist verboten, also steht sie hier - kompakt, aber vollstaendig. */
  function md5(str) {
    const bytes = new TextEncoder().encode(str);
    const n = bytes.length;
    const withOne = n + 1;
    const words = new Int32Array((((withOne + 8) >> 6) + 1) << 4);
    for (let i = 0; i < n; i++) words[i >> 2] |= bytes[i] << ((i % 4) << 3);
    words[n >> 2] |= 0x80 << ((n % 4) << 3);
    words[words.length - 2] = n * 8;

    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const K = [];
    for (let i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    const rol = (x, c) => (x << c) | (x >>> (32 - c));

    let a0 = 1732584193, b0 = -271733879, c0 = -1732584194, d0 = 271733878;
    for (let i = 0; i < words.length; i += 16) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let j = 0; j < 64; j++) {
        let F, g;
        if (j < 16) { F = (B & C) | (~B & D); g = j; }
        else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
        else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * j) % 16; }
        F = (F + A + K[j] + words[i + g]) | 0;
        A = D; D = C; C = B;
        B = (B + rol(F, S[((j >> 4) << 2) | (j & 3)])) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    const hex = x => {
      let out = '';
      for (let i = 0; i < 4; i++) out += ((x >> (i * 8)) & 255).toString(16).padStart(2, '0');
      return out;
    };
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  }

  const salt = () => Math.random().toString(36).slice(2, 10);

  /* Eine feste Kennung, sonst legt Jellyfin bei jedem Besuch ein Geraet an. */
  function deviceId() {
    let id = '';
    try { id = localStorage.getItem('songrate:device') || ''; } catch (e) {}
    if (!id) {
      id = 'songraten-' + Math.random().toString(36).slice(2, 12);
      try { localStorage.setItem('songrate:device', id); } catch (e) {}
    }
    return id;
  }

  /* ------------------------------------------------------------ Abrufen */

  /* Ein fehlgeschlagener Abruf sagt hier, woran es lag - der Browser
     verschweigt CORS- und Mixed-Content-Fehler im `catch` naemlich komplett. */
  async function get(url, opts) {
    opts = opts || {};
    let res;
    try {
      res = await fetch(url, { headers: opts.headers || {}, method: opts.method || 'GET',
                               body: opts.body, mode: 'cors' });
    } catch (e) {
      const e2 = new Error(hint(url));
      e2.network = true;
      throw e2;
    }
    if (res.status === 401 || res.status === 403) {
      const e = new Error('Zugangsdaten stimmen nicht.');
      e.auth = true;
      throw e;
    }
    if (!res.ok) throw new Error('Der Server antwortet mit ' + res.status + '.');
    if (opts.raw) return res;
    return res.json();
  }

  function hint(url) {
    const seite = typeof location !== 'undefined' ? location.protocol : 'https:';
    if (seite === 'https:' && /^http:/i.test(url)) {
      return 'Der Server läuft über http, diese Seite über https – der Browser blockt das. '
        + 'Der Server braucht eine https-Adresse (Reverse Proxy, Tailscale, Cloudflare Tunnel).';
    }
    return 'Keine Antwort. Adresse richtig? Läuft der Server? '
      + 'Und erlaubt er Zugriffe von fremden Seiten (CORS)?';
  }

  /* ----------------------------------------------------------- Subsonic */

  function subAuth(cfg) {
    const s = salt();
    return `u=${encodeURIComponent(cfg.user)}&t=${md5((cfg.pass || '') + s)}&s=${s}`
      + `&v=1.16.1&c=Songraten&f=json`;
  }

  const subUrl = (cfg, ep, extra) =>
    `${clean(cfg.url)}/rest/${ep}?${subAuth(cfg)}${extra ? '&' + extra : ''}`;

  async function subCall(cfg, ep, extra) {
    const data = await get(subUrl(cfg, ep, extra));
    const r = data['subsonic-response'] || {};
    if (r.status === 'failed') {
      const e = new Error((r.error && r.error.message) || 'Der Server lehnt ab.');
      e.auth = r.error && (r.error.code === 40 || r.error.code === 41);
      if (e.auth) e.message = 'Benutzername oder Passwort stimmt nicht.';
      throw e;
    }
    return r;
  }

  const subSong = (cfg, x) => ({
    t: x.title || '', a: x.artist || '', al: x.album || '',
    y: +x.year || 0, g: x.genre || '', dur: +x.duration || 0,
    id: String(x.id),
    full: subUrl(cfg, 'stream', `id=${encodeURIComponent(x.id)}&format=mp3&maxBitRate=192`),
    c: x.coverArt ? subUrl(cfg, 'getCoverArt', `id=${encodeURIComponent(x.coverArt)}&size=400`) : '',
  });

  async function subCheck(cfg) {
    await subCall(cfg, 'ping');
    return { name: cfg.name || 'Subsonic' };
  }

  /* Die Suche mit leerem Begriff liefert bei Navidrome alles; wo nicht,
     tut es der Stern. Geblaettert wird ueber songOffset. */
  async function subTracks(cfg, opts) {
    const out = [];
    for (const q of ['', '*']) {
      for (let off = 0; off < MAX; off += PAGE) {
        if (opts.stop && opts.stop()) return out;
        const r = await subCall(cfg, 'search3',
          `query=${encodeURIComponent(q)}&songCount=${PAGE}&songOffset=${off}&artistCount=0&albumCount=0`);
        const list = (r.searchResult3 && r.searchResult3.song) || [];
        list.forEach(x => out.push(subSong(cfg, x)));
        if (opts.onProgress) opts.onProgress(out.length);
        if (list.length < PAGE) break;
      }
      if (out.length) break;
    }
    return out;
  }

  /* ----------------------------------------------------------- Jellyfin */

  const jfHeader = () => ({
    'X-Emby-Authorization': `MediaBrowser Client="Songraten", Device="Browser", `
      + `DeviceId="${deviceId()}", Version="1.0"`,
  });

  async function jfLogin(cfg) {
    /* Ein API-Schluessel geht auch - dann steht er im Passwortfeld und der
       Benutzername bleibt leer. */
    if (!cfg.user) return { token: cfg.pass, user: '' };
    const data = await get(`${clean(cfg.url)}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: { ...jfHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ Username: cfg.user, Pw: cfg.pass || '' }),
    });
    return { token: data.AccessToken, user: (data.User || {}).Id || '' };
  }

  const jfSong = (cfg, tok, x) => ({
    t: x.Name || '', a: (x.Artists && x.Artists[0]) || x.AlbumArtist || '',
    al: x.Album || '', y: +x.ProductionYear || 0,
    g: (x.Genres && x.Genres[0]) || '',
    dur: x.RunTimeTicks ? x.RunTimeTicks / 1e7 : 0,
    id: String(x.Id),
    full: `${clean(cfg.url)}/Audio/${x.Id}/universal?api_key=${encodeURIComponent(tok.token)}`
      + `&DeviceId=${encodeURIComponent(deviceId())}&AudioCodec=mp3&MaxStreamingBitrate=192000&Container=mp3`,
    c: x.ImageTags && x.ImageTags.Primary
      ? `${clean(cfg.url)}/Items/${x.Id}/Images/Primary?maxHeight=400&api_key=${encodeURIComponent(tok.token)}`
      : '',
  });

  async function jfCheck(cfg) {
    const tok = await jfLogin(cfg);
    if (!tok.token) { const e = new Error('Kein Zugang bekommen.'); e.auth = true; throw e; }
    return { name: cfg.name || 'Jellyfin', token: tok };
  }

  async function jfTracks(cfg, opts) {
    const tok = opts.token || await jfLogin(cfg);
    const out = [];
    for (let off = 0; off < MAX; off += PAGE) {
      if (opts.stop && opts.stop()) break;
      const url = `${clean(cfg.url)}/Items?IncludeItemTypes=Audio&Recursive=true`
        + `&Limit=${PAGE}&StartIndex=${off}&Fields=Genres,ProductionYear`
        + (tok.user ? `&UserId=${encodeURIComponent(tok.user)}` : '')
        + `&api_key=${encodeURIComponent(tok.token)}`;
      const data = await get(url, { headers: jfHeader() });
      const list = data.Items || [];
      list.forEach(x => out.push(jfSong(cfg, tok, x)));
      if (opts.onProgress) opts.onProgress(out.length);
      if (list.length < PAGE) break;
    }
    return out;
  }

  /* --------------------------------------------------------------- Plex */

  const plexHead = cfg => ({ Accept: 'application/json', 'X-Plex-Token': cfg.pass || '' });

  async function plexCheck(cfg) {
    const data = await get(`${clean(cfg.url)}/library/sections`, { headers: plexHead(cfg) });
    const dirs = ((data.MediaContainer || {}).Directory) || [];
    if (!dirs.some(d => d.type === 'artist')) throw new Error('Keine Musikbibliothek gefunden.');
    return { name: cfg.name || 'Plex' };
  }

  const plexSong = (cfg, x) => {
    const part = (((x.Media || [])[0] || {}).Part || [])[0] || {};
    const tok = encodeURIComponent(cfg.pass || '');
    return {
      t: x.title || '', a: x.grandparentTitle || '', al: x.parentTitle || '',
      y: +x.parentYear || +x.year || 0, g: '',
      dur: x.duration ? x.duration / 1000 : 0,
      id: String(x.ratingKey),
      full: part.key ? `${clean(cfg.url)}${part.key}?X-Plex-Token=${tok}` : '',
      c: x.thumb ? `${clean(cfg.url)}${x.thumb}?X-Plex-Token=${tok}` : '',
    };
  };

  async function plexTracks(cfg, opts) {
    const secs = await get(`${clean(cfg.url)}/library/sections`, { headers: plexHead(cfg) });
    const musik = (((secs.MediaContainer || {}).Directory) || []).filter(d => d.type === 'artist');
    const out = [];
    for (const s of musik) {
      for (let off = 0; off < MAX; off += PAGE) {
        if (opts.stop && opts.stop()) return out;
        const url = `${clean(cfg.url)}/library/sections/${s.key}/all?type=10`
          + `&X-Plex-Container-Start=${off}&X-Plex-Container-Size=${PAGE}`;
        const data = await get(url, { headers: plexHead(cfg) });
        const list = ((data.MediaContainer || {}).Metadata) || [];
        list.forEach(x => { const song = plexSong(cfg, x); if (song.full) out.push(song); });
        if (opts.onProgress) opts.onProgress(out.length);
        if (list.length < PAGE) break;
      }
      if (out.length >= MAX) break;
    }
    return out;
  }

  /* ------------------------------------------------------------ nach aussen */

  const HANDLER = {
    subsonic: { check: subCheck, tracks: subTracks },
    jellyfin: { check: jfCheck, tracks: jfTracks },
    plex:     { check: plexCheck, tracks: plexTracks },
  };

  async function check(cfg) {
    const h = HANDLER[cfg.kind];
    if (!h) throw new Error('Unbekannte Art von Server.');
    if (!clean(cfg.url)) throw new Error('Ohne Adresse geht es nicht.');
    return h.check(cfg);
  }

  async function tracks(cfg, opts) {
    const h = HANDLER[cfg.kind];
    if (!h) throw new Error('Unbekannte Art von Server.');
    const list = await h.tracks(cfg, opts || {});
    /* Ohne Titel oder ohne abspielbare Adresse ist ein Eintrag wertlos. */
    return list.filter(s => s.t && s.full).slice(0, MAX);
  }

  /* Zugangsdaten bleiben im Browser. Bewusst nur hier und nirgends sonst. */
  const KEY = 'songrate:server';
  function store(cfg) {
    try {
      if (cfg) localStorage.setItem(KEY, JSON.stringify(cfg));
      else localStorage.removeItem(KEY);
    } catch (e) {}
  }
  function restore() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  return { KINDS, check, tracks, store, restore, md5, deviceId, MAX };
})();
