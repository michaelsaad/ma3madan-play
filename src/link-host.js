// The computer side of the phone app (Ma3madan Remote, ma3madan-remote.pages.dev), in the page of
// whichever app holds the link (see hub.js: Ma3madan Play or Ma3madan PPT, one link for both).
// While the remote is on it keeps a socket open to this computer's room at the signaling server,
// and connects every phone that knocks directly over the Wi-Fi (a WebRTC data channel, link.js).
// Messages from phones go to hub.js, which hands each one to its app; what the apps send comes
// back here for the phones.
//
// Three ways a phone gets in:
// - trusted before: its offer arrives encrypted with its own key, and it's in straight away;
// - it just scanned the QR code: the offer is encrypted with the pairing code; it's trusted and
//   gets a key of its own (the code changes after each use, so a photo of it is worth nothing);
// - from "Nearby computers" on the phone (same network, no QR code): nothing happens until this
//   computer approves it: "Trust this device", "Just this time", or "Don't allow".
// eslint-disable-next-line no-unused-vars
const LinkHost = (() => {
  const APP_URL = MaLink.BASE + '/';
  let id = null, opts = {}, sock = null, running = false, online = null, presenceTimer = null, sweepTimer = null;
  const keys = new Map();  // device id → CryptoKey
  let pairing = null;      // CryptoKey for the QR code's pairing code
  const peers = new Map(); // phone id → { pc, ctl, img, device, deviceId, key, approved, code, seen, route }

  // identity: { hostId, auth, pairCode, name, devices: { id: { key, name } } }
  // options: { onNet(peer, msg), onPeers(list), onRequest({device, code}) → 'trust'|'once'|'deny',
  //            onCancel(code), trust({device}) → { deviceId, key }, seen(deviceId), apps() → ['play',…], onOnline(bool) }
  async function start(identity, options) {
    stop();
    id = identity; opts = options; running = true;
    await setIdentity(identity);
    sock = MaLink.socket({
      room: id.hostId, role: 'host', auth: id.auth, keep: true,
      onopen: () => setOnline(true),
      onclose: () => setOnline(false),
      onmessage: m => signal(m).catch(e => console.warn('link', e)),
    });
    announce();
    // Another network (a hotspot, the Wi-Fi back): reconnect to the room at once.
    addEventListener('online', onOnline);
    // A phone that went quiet (no ping for 20 s: it slept, or left the Wi-Fi) is let go.
    sweepTimer = setInterval(() => {
      for (const [pid, p] of peers) if (p.approved && Date.now() - p.seen > 15000) drop(pid, p);
    }, 5000);
  }
  // New pairing code or trusted list (after a phone was trusted or forgotten).
  async function setIdentity(identity) {
    id = identity;
    pairing = id.pairCode ? await MaLink.pairKey(id.pairCode) : null;
    keys.clear();
    for (const [devId, d] of Object.entries(id.devices || {})) {
      try { keys.set(devId, await MaLink.deviceKey(d.key)); } catch {}
    }
    // A forgotten phone is cut off at once.
    for (const [pid, p] of peers) if (p.deviceId && !keys.has(p.deviceId)) drop(pid, p);
  }
  function onOnline() { sock?.reconnect(); announce(); }
  function setOnline(v) { if (online !== v) { online = v; opts.onOnline?.(v); changed(); } }
  function stop() {
    // Off the phones' "nearby" list right away (not after it times out).
    if (running && id) MaLink.leave(id.hostId, id.auth).catch(() => {});
    running = false;
    removeEventListener('online', onOnline);
    clearTimeout(presenceTimer); clearInterval(sweepTimer);
    sock?.close(); sock = null;
    for (const p of peers.values()) close(p);
    peers.clear();
    online = null;
    changed();
  }
  // "I'm here" for phones on the same network, every 30 s (and when the apps change).
  async function announce() {
    clearTimeout(presenceTimer);
    if (!running) return;
    try { await MaLink.announce(id.hostId, id.name, id.auth, opts.apps?.() || []); } catch {}
    presenceTimer = setTimeout(announce, 30000);
  }

  // ---------- signaling ----------
  async function signal(m) {
    if (!running) return;
    if (m.type === 'gone') { const p = peers.get(m.from); if (p && (!p.ctl || p.relay)) drop(m.from, p); return; }
    if (m.type === 'r') { relayed(m.from, m.box).catch(() => {}); return; }
    const pid = m.from;
    if (typeof pid !== 'string') return;
    if (m.type === 'offer') {
      let key = null, offer = null, how = null;
      if (m.dev && keys.has(m.dev)) { key = keys.get(m.dev); how = 'trusted'; }
      else if (m.pair && pairing) { key = pairing; how = 'pair'; }
      if (key) {
        try { offer = await MaLink.unseal(key, m.box); } catch { offer = null; }
        if (!offer) return;
      } else if (m.dev) {
        // A phone this computer forgot (or a copy of an old one): tell it to pair again.
        sock?.send({ to: pid, type: 'unknown' });
        return;
      } else if (m.open && typeof m.sdp === 'string') {
        offer = { sdp: m.sdp, device: m.device };
        how = 'nearby';
      } else return;
      accept(pid, offer, how, key, m.dev || null).catch(e => console.warn('link', e));
    } else if (m.type === 'ice') {
      const p = peers.get(pid);
      if (!p) return;
      let c = null;
      try { c = p.key ? (await MaLink.unseal(p.key, m.box)).c : m.c; } catch { return; }
      if (c) p.pc.addIceCandidate(c).catch(() => {});
    }
  }
  // A phone that can't reach this computer directly talks through the room instead (see
  // relayChannel in link.js): { o: 1 } opens, { d } carries one message.
  const early = new Map(); // phone id → relay messages that came before its offer was taken in
  async function relayed(pid, box) {
    const peer = peers.get(pid);
    if (!peer) { const q = early.get(pid) || []; if (q.length < 50) q.push(box); early.set(pid, q); setTimeout(() => early.delete(pid), 15000); return; }
    if (!peer.key) return; // only phones with a key (trusted, or the QR code); never from Nearby
    let b; try { b = await MaLink.unseal(peer.key, box); } catch { return; }
    if (b.o && !peer.relay) {
      const pc = peer.pc;
      // The direct channels, if any came, are let go quietly (their "closed" isn't the phone leaving).
      for (const ch of [peer.ctl, peer.img]) if (ch) { ch.onclose = null; ch.onmessage = null; ch.onopen = null; }
      pc.onconnectionstatechange = null; pc.ondatachannel = null;
      try { pc.close(); } catch {}
      const send = async d => sock?.send({ to: pid, type: 'r', box: await MaLink.seal(peer.key, { d }) });
      peer.relay = true; peer.route = 'relay';
      peer.ctl = MaLink.relayChannel(send); peer.img = MaLink.relayChannel(send);
      wire(pid, peer, peer.ctl);
      peer.ctl.onopen();
    } else if (typeof b.d === 'string' && peer.relay) peer.ctl.onmessage?.({ data: b.d });
  }
  const sendSignal = async (pid, p, obj) => {
    if (p.key) sock?.send({ to: pid, type: obj.type, box: await MaLink.seal(p.key, obj) });
    else sock?.send({ to: pid, ...obj });
  };

  async function accept(pid, offer, how, key, deviceId) {
    if (peers.has(pid)) close(peers.get(pid));
    const pc = new RTCPeerConnection({ iceServers: await MaLink.iceServers() });
    const peer = {
      pc, ctl: null, img: null, device: String(offer.device || 'Phone').slice(0, 24), deviceId, key,
      approved: how === 'trusted', how, code: null, seen: Date.now(), route: null,
    };
    peers.set(pid, peer);
    for (const box of early.get(pid) || []) relayed(pid, box).catch(() => {});
    early.delete(pid);
    pc.ondatachannel = e => {
      if (e.channel.label === 'img') { peer.img = e.channel; return; }
      peer.ctl = e.channel; wire(pid, peer, e.channel);
    };
    pc.onicecandidate = e => { if (e.candidate) sendSignal(pid, peer, { type: 'ice', c: e.candidate.toJSON() }).catch(() => {}); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(pid, peer);
      if (pc.connectionState === 'connected') MaLink.route(pc).then(r => { peer.route = r; changed(); });
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    if (how === 'nearby') peer.code = await MaLink.sasCode(offer.sdp, pc.localDescription.sdp);
    // The answer goes at once; the network addresses follow as they're found.
    await sendSignal(pid, peer, { type: 'answer', sdp: pc.localDescription.sdp, name: id.name });
  }

  function wire(pid, peer, dc) {
    const hello = () => {
      dc.send(JSON.stringify({ type: 'hello', name: id.name, hostId: id.hostId, apps: opts.apps?.() || [] }));
      opts.onNet?.(pid, { type: 'joined' });
    };
    dc.onopen = async () => {
      changed();
      if (peer.approved) { if (peer.deviceId) opts.seen?.(peer.deviceId); hello(); return; }
      let answer = 'trust';
      // From "Nearby computers": ask here first. Nothing is sent or obeyed until then.
      if (peer.how === 'nearby') answer = await opts.onRequest({ device: peer.device, code: peer.code });
      if (dc.readyState !== 'open') return;
      if (answer === 'trust') {
        const t = await opts.trust({ device: peer.device });
        peer.approved = true; peer.deviceId = t.deviceId;
        dc.send(JSON.stringify({ type: 'paired', hostId: id.hostId, deviceId: t.deviceId, key: t.key, name: id.name }));
        hello();
      } else if (answer === 'once') {
        peer.approved = true;
        dc.send(JSON.stringify({ type: 'welcome', name: id.name }));
        hello();
      } else {
        dc.send(JSON.stringify({ type: 'denied' }));
        setTimeout(() => drop(pid, peer), 2000); // let the message reach the phone first
      }
      changed();
    };
    dc.onmessage = e => {
      peer.seen = Date.now();
      if (!peer.approved) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'ping') { if (dc.readyState === 'open') dc.send('{"type":"pong"}'); return; }
      if (typeof m.app === 'string' && typeof m.type === 'string') opts.onNet?.(pid, m);
    };
    dc.onclose = () => { drop(pid, peer); opts.onCancel?.(peer.code); };
  }
  function drop(pid, peer) {
    if (peers.get(pid) !== peer) return;
    peers.delete(pid); close(peer); changed();
    opts.onNet?.(pid, { type: 'left' });
  }
  function close(p) { try { p.ctl?.close(); } catch {} try { p.img?.close(); } catch {} try { p.pc.close(); } catch {} }
  function changed() { opts.onPeers?.(list()); }
  const list = () => [...peers.entries()].filter(([, p]) => p.approved && p.ctl?.readyState === 'open')
    .map(([pid, p]) => ({ peer: pid, device: p.device, deviceId: p.deviceId, route: p.route }));

  // To one phone (peer) or to every connected one (peer null). Pictures go on their own channel,
  // in parts, so they never hold up a tap or the state.
  function send(peer, msg) {
    const targets = peer ? [peers.get(peer)].filter(Boolean) : [...peers.values()];
    const big = msg.type === 'thumb' && typeof msg.data === 'string';
    const s = big ? null : JSON.stringify(msg);
    for (const p of targets) {
      if (!p.approved || p.ctl?.readyState !== 'open') continue;
      try {
        if (big) {
          const ch = p.img?.readyState === 'open' ? p.img : p.ctl;
          if (ch.bufferedAmount > 4 * 1024 * 1024) continue; // a phone that can't keep up skips pictures
          MaLink.sendParts(ch, { app: msg.app, type: 'thumb', id: msg.id, v: msg.v }, msg.data);
        } else p.ctl.send(s);
      } catch (e) { console.warn('link send', e.message); }
    }
  }
  const pairUrl = () => `${APP_URL}#pair=${encodeURIComponent(id.hostId + '.' + id.pairCode)}&name=${encodeURIComponent(id.name || '')}`;

  return {
    start, stop, setIdentity, send, announce, pairUrl, peers: list,
    isRunning: () => running, isOnline: () => online,
  };
})();
