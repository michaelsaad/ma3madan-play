// Ma3madan Link: connects a phone to the computer apps (Ma3madan Play and Ma3madan PPT) with WebRTC.
// One connection per phone and computer carries both apps (the computer side is a "hub", see
// hub.js in the apps).
//
// - Every computer has a room at the signaling server (ma3madan-remote.pages.dev/api/ws, one
//   Durable Object per computer). While the remote is on, the computer keeps a socket open there;
//   a phone opens one only to connect. Messages pass live and are never stored.
// - Pairing: the QR code holds the computer's id and a one-time pairing code, after "#" (never
//   sent to any server). The phone's first offer is encrypted with a key made from that code; the
//   computer then gives this phone a key of its own, so each phone can be forgotten on its own.
// - Every message through the server is encrypted (AES-GCM) with the phone's key, so the server
//   can neither read nor forge them. Phones from "Nearby computers" have no key yet: the computer
//   must approve them, comparing a code made from both ends' certificates (sasCode).
// - Then the two talk directly over an encrypted data channel. When the Wi-Fi keeps devices
//   apart, a relay (TURN, /api/turn) carries the same encrypted channel instead.
//
// The same file is used by the phone app and by both computer apps (copy it when it changes:
// public/link.js here → src/link.js in ma3madan-play and ma3madan-ppt).
(function (root) {
  // The phone app uses the server it was opened from (also a test copy); the computer apps use
  // the real one unless MA3MADAN_BASE is set (tests).
  const HOME = 'https://ma3madan-remote.pages.dev';
  const here = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) &&
    /(^|\.)ma3madan-remote\.pages\.dev$|^localhost$|^127\.0\.0\.1$/.test(location.hostname) ? location.origin : null;
  const BASE = root.MA3MADAN_BASE || here || HOME;
  const WS = BASE.replace(/^http/, 'ws') + '/api/ws';
  const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }];
  const enc = new TextEncoder(), dec = new TextDecoder();

  const toB64 = bytes => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); };
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  const b64url = bytes => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const randomId = (bytes = 9) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
  const randomHex = (bytes = 16) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
  const newKey = () => randomId(32); // a phone's own key (256 bits, base64url)

  // ---------- encryption ----------
  async function aes(raw) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  // A phone's own key, from its base64url text.
  async function deviceKey(text) {
    return aes(fromB64(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)));
  }
  // The key for a first connection from the QR code.
  async function pairKey(code) { return aes(await crypto.subtle.digest('SHA-256', enc.encode('ma3madan-pair:' + code))); }
  async function seal(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return toB64(iv) + '.' + toB64(data);
  }
  async function unseal(key, sealed) {
    const [iv, data] = String(sealed || '').split('.');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(data));
    return JSON.parse(dec.decode(plain));
  }
  // The same 4 digits on both screens only if both ends see the same two certificates.
  async function sasCode(sdpA, sdpB) {
    const fp = sdp => (/a=fingerprint:\S+ (\S+)/.exec(sdp || '') || [])[1] || '';
    const both = [fp(sdpA), fp(sdpB)].sort().join('|');
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(both)));
    return String(((h[0] << 16) | (h[1] << 8) | h[2]) % 10000).padStart(4, '0');
  }

  // ---------- relays ----------
  // STUN always; TURN relays when the server has them. Kept for half an hour.
  let ice = null;
  async function iceServers() {
    if (ice && Date.now() - ice.at < 30 * 60e3) return ice.list;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch(BASE + '/api/turn', { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      const { iceServers: list } = await r.json();
      if (Array.isArray(list) && list.length) { ice = { at: Date.now(), list }; return list; }
    } catch {}
    return ice?.list || STUN;
  }
  // Which way the connection went: 'direct' (same Wi-Fi), 'relay' (TURN), or null.
  async function route(pc) {
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach(s => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
      if (!pair) stats.forEach(s => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
      const local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId);
      if (!local) return null;
      return local.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct';
    } catch { return null; }
  }

  // ---------- the signaling socket ----------
  // A WebSocket to a computer's room. The computer keeps it open (reconnecting by itself); a
  // phone closes it once connected. onmessage gets parsed JSON.
  function socket({ room, role, peer, auth, onmessage, onopen, onclose, keep = false }) {
    let ws = null, pingTimer = null, retry = 1000, closed = false, retryTimer = null;
    const s = {
      get open() { return ws?.readyState === 1; },
      send(obj) { if (ws?.readyState === 1) { ws.send(JSON.stringify(obj)); return true; } return false; },
      close() { closed = true; clearTimeout(retryTimer); clearInterval(pingTimer); try { ws?.close(); } catch {} },
      // The network changed (another Wi-Fi, a hotspot): don't wait for the next try.
      reconnect() { if (closed || ws?.readyState === 1 || ws?.readyState === 0) return; clearTimeout(retryTimer); retry = 1000; connect(); },
    };
    const connect = () => {
      const q = new URLSearchParams({ room, role });
      if (peer) q.set('peer', peer);
      if (auth) q.set('auth', auth);
      ws = new WebSocket(`${WS}?${q}`);
      const me = ws;
      me.onopen = () => {
        retry = 1000;
        clearInterval(pingTimer);
        // Keepalive: answered by the server without waking the room.
        pingTimer = setInterval(() => { if (me.readyState === 1) me.send('ping'); }, 25000);
        onopen?.();
      };
      me.onmessage = e => {
        if (e.data === 'pong') return;
        let m; try { m = JSON.parse(e.data); } catch { return; }
        onmessage?.(m);
      };
      me.onclose = e => {
        clearInterval(pingTimer);
        if (ws !== me) return;
        onclose?.(e.code);
        if (closed || !keep || e.code === 4000) return; // 4000: another socket took over
        retryTimer = setTimeout(connect, retry);
        retry = Math.min(retry * 2, 5000);
      };
    };
    connect();
    return s;
  }

  // ---------- nearby computers (no QR code) ----------
  const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
  const announce = (host, name, auth, apps) => post('/api/presence', { host, name, auth, apps });
  const leave = (host, auth) => post('/api/presence', { host, auth, leave: true });
  async function nearby() {
    const r = await fetch(BASE + '/api/presence', { cache: 'no-store' });
    if (!r.ok) throw new Error('presence ' + r.status);
    return ((await r.json()).hosts || []).filter(h => h.apps); // older apps (no "apps") can't be reached any more
  }

  // ---------- big messages ----------
  // Data channels take small messages best (iPhones refuse over 64 KB): pictures go in parts.
  const PART = 16 * 1024;
  function sendParts(dc, head, data) {
    const n = Math.max(1, Math.ceil(data.length / PART));
    for (let i = 0; i < n; i++) dc.send(JSON.stringify({ ...head, i, n, data: data.slice(i * PART, (i + 1) * PART) }));
  }
  // Puts parts back together: feed every message, get the whole one back (or null).
  function assembler() {
    const parts = new Map();
    return m => {
      if (m.n == null || m.n === 1) return m;
      const k = `${m.app}|${m.id}|${m.v}`;
      const got = parts.get(k) || [];
      got[m.i] = m.data;
      parts.set(k, got);
      if (got.filter(x => x != null).length < m.n) return null;
      parts.delete(k);
      return { ...m, data: got.join(''), i: undefined, n: undefined };
    };
  }

  // Wait for a data channel to open (or fail after ms).
  function waitOpen(channel, ms) {
    return new Promise((ok, fail) => {
      if (channel.readyState === 'open') return ok();
      const t0 = setTimeout(() => fail(new Error('no channel')), ms);
      channel.addEventListener('open', () => { clearTimeout(t0); ok(); }, { once: true });
      channel.addEventListener('close', () => { clearTimeout(t0); fail(new Error('closed')); }, { once: true });
    });
  }

  // When the two can't reach each other directly (the phone is itself the hotspot, Wi-Fi that keeps
  // devices apart, a firewall), the same messages go through the computer's room instead,
  // encrypted with the phone's key. This stands in for a data channel: send() and onmessage.
  function relayChannel(sendSealed) {
    let queue = Promise.resolve();
    const ch = {
      readyState: 'open', bufferedAmount: 0, onmessage: null, onopen: null, onclose: null,
      send(data) { queue = queue.then(() => sendSealed(String(data))).catch(() => {}); },
      close() { ch.readyState = 'closed'; },
    };
    return ch;
  }

  root.MaLink = {
    BASE, STUN, randomId, randomHex, newKey, deviceKey, pairKey, seal, unseal, sasCode,
    iceServers, route, socket, announce, leave, nearby, sendParts, assembler, waitOpen, relayChannel,
  };
})(typeof window !== 'undefined' ? window : globalThis);
