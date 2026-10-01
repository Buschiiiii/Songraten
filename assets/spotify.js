/* Spotify: anmelden und die eigenen Playlists holen - ohne Server.

   Das geht ueber „Authorization Code with PKCE", das Verfahren, das Spotify
   genau fuer Seiten ohne Backend vorsieht: kein Client-Secret, der Tausch
   Code gegen Token laeuft im Browser. Was es braucht, ist eine eigene App im
   Spotify-Dashboard - ihre Client ID und als Redirect-URI diese Seite.

   Was es nicht bringt: Ton. Spotify gibt neuen Apps seit Ende 2024 keine
   Hoerproben mehr, und das Web Playback SDK kann keine 0,01 Sekunden.
   Gespielt wird also weiter Apples Preview; Spotify liefert die Titelliste,
   die dann wie ein Export aufgeloest wird (playlist.js).

   Seit Maerz 2026 gilt fuer Apps im Entwicklungsmodus ausserdem: Titel nur
   aus Playlists, die einem gehoeren oder bei denen man mitarbeitet, dazu die
   Lieblingssongs; der Endpunkt heisst /items, der Song darin `item`; keine
   ISRC mehr; die App braucht ein Premium-Konto ihres Besitzers und nimmt
   hoechstens fuenf freigeschaltete Nutzer. */

const Spotify = (() => {

  const KEY = 'songrate:spotify';
  /* Eine hier eingetragene Client ID erspart jedem Besucher die eigene App -
     er muss dann nur im Dashboard freigeschaltet sein. Leer: jeder traegt
     seine eigene ein. Eine Client ID ist kein Geheimnis. */
  const CLIENT_ID = 'a26fcfca3c684360805f5e0b8112ff4c';
  const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';
  const AUTH = 'https://accounts.spotify.com/authorize';
  const TOKEN = 'https://accounts.spotify.com/api/token';
  const API = 'https://api.spotify.com/v1/';
  const PAGE = 50;

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function save(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  /* Eine selbst eingetragene ID gewinnt - wer nicht in der eingebauten App
     freigeschaltet ist, nimmt seine eigene. */
  const ownId = () => load().clientId || '';
  const clientId = () => ownId() || CLIENT_ID;
  function setClientId(id) {
    const st = load();
    st.clientId = String(id || '').trim();
    save(st);
  }

  /* Wohin Spotify zurueckschickt. Genau so muss die Adresse im Dashboard
     stehen, Schraegstrich am Ende eingeschlossen - sonst lehnt Spotify mit
     „INVALID_CLIENT: Invalid redirect URI" ab. */
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

  /* Ohne https gibt es kein crypto.subtle, und ohne das keinen PKCE-Code. */
  const ready = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);

  function random(n) {
    const zeichen = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    return Array.from(crypto.getRandomValues(new Uint8Array(n)), x => zeichen[x % zeichen.length]).join('');
  }

  async function challenge(verifier) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /* Austauschbar, damit der Test nicht wirklich wegnavigiert. */
  const nav = { go: url => location.assign(url) };

  async function login() {
    const id = clientId();
    if (!id) throw new Error('Erst die Client ID eintragen.');
    if (!ready()) throw new Error('Anmelden geht nur über https.');
    const verifier = random(64), state = random(16);
    const st = load();
    st.verifier = verifier;
    st.state = state;
    save(st);
    const p = new URLSearchParams({
      response_type: 'code', client_id: id, scope: SCOPES, redirect_uri: redirectUri(),
      code_challenge_method: 'S256', code_challenge: await challenge(verifier), state,
    });
    nav.go(AUTH + '?' + p);
  }

  async function tokenCall(params) {
    try {
      return await fetch(TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
      });
    } catch (e) {
      throw Object.assign(new Error('Spotify ist gerade nicht erreichbar.'),
                          { url: TOKEN, net: true, cause: String(e && e.message || e) });
    }
  }

  function keep(st, tok) {
    st.access = tok.access_token;
    st.exp = Date.now() + (tok.expires_in || 3600) * 1000;
    /* Spotify tauscht den Refresh-Token bei PKCE oft mit aus. */
    if (tok.refresh_token) st.refresh = tok.refresh_token;
    save(st);
  }

  /* Rueckkehr von Spotify: ?code=…&state=… steht in der Adresse. Laeuft beim
     Start einmal; danach wird die Adresse wieder sauber gemacht, damit ein
     Neuladen den Code nicht ein zweites Mal einloest. */
  async function callback() {
    const q = new URLSearchParams(location.search);
    if (!q.has('state') || (!q.has('code') && !q.has('error'))) return null;
    const st = load();
    try { history.replaceState(null, '', redirectUri() + location.hash); } catch (e) {}
    const passt = st.state && q.get('state') === st.state;
    const verifier = st.verifier;
    delete st.state;
    delete st.verifier;
    save(st);
    if (!passt) return { ok: false, error: 'Die Rückmeldung von Spotify passt nicht zur Anmeldung – bitte nochmal.' };
    if (q.has('error')) {
      return { ok: false, error: q.get('error') === 'access_denied'
        ? 'Anmeldung abgebrochen.' : 'Spotify meldet: ' + q.get('error') };
    }
    const res = await tokenCall({
      grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(),
      client_id: clientId(), code_verifier: verifier || '',
    });
    if (!res.ok) {
      return { ok: false, error: `Spotify hat die Anmeldung nicht angenommen (${res.status}).`,
               cause: Object.assign(new Error('HTTP ' + res.status), { url: TOKEN, status: res.status }) };
    }
    keep(load(), await res.json());
    return { ok: true };
  }

  const loggedIn = () => { const st = load(); return !!(st.access || st.refresh); };

  function logout() {
    const st = load();
    save(st.clientId ? { clientId: st.clientId } : {});
  }

  const authError = () => Object.assign(new Error('Bitte neu anmelden.'), { auth: true });

  async function token() {
    const st = load();
    if (st.access && st.exp > Date.now() + 60000) return st.access;
    if (!st.refresh) throw authError();
    const res = await tokenCall({ grant_type: 'refresh_token', refresh_token: st.refresh, client_id: clientId() });
    if (!res.ok) { logout(); throw authError(); }
    keep(st, await res.json());
    return load().access;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function api(path, nochmal) {
    const url = path.startsWith('https://') ? path : API + path;
    /* `next` kommt aus der Antwort. Das Token geht nur an Spotify selbst -
       eine Antwort, die woandershin zeigt, wird nicht befolgt. */
    if (!url.startsWith(API)) throw new Error('Spotify verweist auf eine fremde Adresse.');
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: 'Bearer ' + await token() } });
    } catch (e) {
      if (e && e.auth) throw e;
      throw Object.assign(new Error('Spotify ist gerade nicht erreichbar.'),
                          { url, net: true, cause: String(e && e.message || e) });
    }
    if (res.status === 401 && !nochmal) {
      const st = load(); st.exp = 0; save(st);
      return api(path, true);
    }
    if (res.status === 401) { logout(); throw authError(); }
    if (res.status === 429 && !nochmal) {
      const h = res.headers && res.headers.get ? res.headers.get('Retry-After') : null;
      await sleep(Math.min(30, +(h || 5)) * 1000);
      return api(path, true);
    }
    if (res.status === 403) throw Object.assign(new Error('Das gibt Spotify nicht heraus.'), { forbidden: true, url, status: 403 });
    if (!res.ok) throw Object.assign(new Error(`Spotify antwortet mit ${res.status}.`), { url, status: res.status });
    return res.json();
  }

  async function me() {
    const m = await api('me');
    const st = load();
    st.user = { id: m.id, name: m.display_name || m.id };
    save(st);
    return st.user;
  }
  const user = () => load().user || null;

  /* Eigene Playlists. Lesbar sind nur die, die einem gehoeren oder bei denen
     man mitarbeitet - die uebrigen kommen trotzdem mit, ausgegraut, damit
     niemand sucht, wo seine Playlist geblieben ist. */
  async function playlists() {
    const u = user() || await me();
    const out = [];
    let next = 'me/playlists?limit=' + PAGE;
    while (next && out.length < 1000) {
      const page = await api(next);
      (page.items || []).forEach(p => {
        if (!p || !p.id) return;
        const owner = p.owner || {};
        out.push({
          id: p.id,
          name: p.name || '–',
          count: (p.items || p.tracks || {}).total || 0,
          owner: owner.display_name || owner.id || '',
          /* Nur eine Vermutung aus den Metadaten - ob Spotify die Titel
             wirklich herausgibt, zeigt erst der Versuch. */
          readable: owner.id === u.id || !!p.collaborative,
        });
      });
      next = page.next;
    }
    return out;
  }

  /* Die Titel einer Playlist, `'liked'` fuer die Lieblingssongs. Kuenstler
     mit Semikolon getrennt wie bei Exportify, der erste zusaetzlich als
     `lead` - so bleibt „Earth, Wind & Fire" beim Suchen ein Name. Episoden
     fliegen raus. */
  async function tracks(id, opts) {
    opts = opts || {};
    const max = opts.max || 300;
    const out = [];
    let next = id === 'liked' ? `me/tracks?limit=${PAGE}` : `playlists/${encodeURIComponent(id)}/items?limit=${PAGE}`;
    while (next && out.length < max) {
      const page = await api(next);
      (page.items || []).forEach(e => {
        const t = e && (e.item || e.track);
        if (!t || !t.name || (t.type && t.type !== 'track')) return;
        out.push({
          title: t.name,
          artist: (t.artists || []).map(a => a && a.name).filter(Boolean).join(';'),
          lead: ((t.artists || [])[0] || {}).name || '',
          album: (t.album && t.album.name) || '',
        });
      });
      if (opts.onProgress) opts.onProgress(out.length, page.total || out.length);
      next = page.next;
    }
    return out.slice(0, max);
  }

  return { clientId, ownId, setClientId, redirectUri, ready, login, callback, loggedIn, logout,
           me, user, playlists, tracks, nav, FIXED: !!CLIENT_ID };
})();
