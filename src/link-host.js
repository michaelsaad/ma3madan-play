// The computer side of the phone app (Ma3madan Remote, ma3madan-remote.pages.dev): while the phone
// remote is on, it watches the signaling server for phones and connects to each one directly over
// the Wi-Fi (a WebRTC data channel, see link.js). The phone gets the same state and sends the same
// commands as the Wi-Fi remote page served by remote.js.
//
// Two ways a phone gets in:
// - paired (scanned the QR code, or trusted before): it knows the key, its offer arrives encrypted
//   in our room, and it's in straight away;
// - from "Nearby computers" on the phone (same network, no QR code): its offer arrives in our
//   lobby, and nothing happens until this computer approves it: "Trust this device" (it gets the
//   key and connects by itself from then on), "Just this time", or "Don't allow".
const LinkHost = (() => {
  const APP_URL = 'https://ma3madan-remote.pages.dev/';
  let link = null, secret = null, running = false, timer = null, presenceTimer = null, opts = {}, online = null;
  let cursor = 0, lobbyCursor = 0;
  let lastState = null;
  const peers = new Map(); // phone id → { pc, dc, device, approved, code }

  async function start(key, options) {
    stop();
    secret = key; opts = options; running = true;
    link = await MaLink.deriveLink(key);
    // Offers left before we started are stale: begin after the newest message waiting.
    try {
      const old = await MaLink.receive(link, 'host', 0);
      cursor = old.length ? old[old.length - 1].id : 0;
      const oldLobby = await MaLink.receiveOpen(opts.lobby, 'host', 0);
      lobbyCursor = oldLobby.length ? oldLobby[oldLobby.length - 1].id : 0;
      online = true;
    } catch { online = false; }
    announce();
    loop();
  }
  function stop() {
    // Off the phones' "nearby" list right away (not after it times out).
    if (running && opts.hostId) MaLink.leave(opts.hostId).catch(() => {});
    running = false;
    clearTimeout(timer); clearTimeout(presenceTimer);
    for (const p of peers.values()) close(p);
    peers.clear();
    changed();
  }
  // "I'm here" for phones on the same network, every 20 s.
  async function announce() {
    if (!running) return;
    try { await MaLink.announce(opts.hostId, opts.name, opts.lobby); } catch {}
    presenceTimer = setTimeout(announce, 20000);
  }
  async function loop() {
    if (!running) return;
    try {
      const [msgs, lobby] = await Promise.all([MaLink.receive(link, 'host', cursor), MaLink.receiveOpen(opts.lobby, 'host', lobbyCursor)]);
      for (const m of msgs) {
        cursor = Math.max(cursor, m.id);
        if (m.msg?.type === 'offer' && Math.abs(Date.now() - m.msg.ts) < 60000) accept(m.from, m.msg, true).catch(e => console.warn('link', e));
      }
      for (const m of lobby) {
        lobbyCursor = Math.max(lobbyCursor, m.id);
        if (m.msg?.type === 'offer' && typeof m.msg.sdp === 'string' && Math.abs(Date.now() - m.msg.ts) < 60000 && !peers.has(m.from)) {
          accept(m.from, m.msg, false).catch(e => console.warn('link', e));
        }
      }
      if (online !== true) { online = true; changed(); }
    } catch {
      if (online !== false) { online = false; changed(); }
    }
    timer = setTimeout(loop, 2000);
  }
  async function accept(id, offer, paired) {
    if (peers.has(id)) close(peers.get(id));
    const pc = new RTCPeerConnection({ iceServers: MaLink.ICE_SERVERS });
    const peer = { pc, dc: null, device: String(offer.device || 'Phone').slice(0, 20), approved: paired, code: null };
    peers.set(id, peer);
    pc.ondatachannel = e => { peer.dc = e.channel; wire(id, peer, e.channel); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(id, peer);
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await MaLink.gathered(pc);
    const answer = { type: 'answer', sdp: pc.localDescription.sdp, name: opts.name };
    if (paired) await MaLink.send(link, 'host', id, answer);
    else {
      peer.code = await MaLink.sasCode(offer.sdp, pc.localDescription.sdp);
      await MaLink.sendOpen(opts.lobby, 'host', id, answer);
    }
  }
  function wire(id, peer, dc) {
    dc.onopen = async () => {
      changed();
      if (peer.approved) { if (lastState) dc.send(JSON.stringify({ type: 'state', state: lastState })); return; }
      // Not paired: ask here first. Nothing is sent or obeyed until then.
      const answer = await opts.onRequest({ device: peer.device, code: peer.code });
      if (dc.readyState !== 'open') return;
      if (answer === 'trust' || answer === 'once') {
        peer.approved = true;
        dc.send(JSON.stringify(answer === 'trust' ? { type: 'paired', secret, name: opts.name } : { type: 'welcome', name: opts.name }));
        if (lastState) dc.send(JSON.stringify({ type: 'state', state: lastState }));
      } else {
        dc.send(JSON.stringify({ type: 'denied' }));
        setTimeout(() => drop(id, peer), 2000); // let the message reach the phone first
      }
      changed();
    };
    dc.onmessage = async e => {
      if (!peer.approved) return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'cmd' && m.cmd && typeof m.cmd.action === 'string') opts.onCommand(m.cmd);
      else if (m.type === 'thumb' && typeof m.id === 'string') {
        const data = await opts.thumb(m.id);
        if (data && dc.readyState === 'open') dc.send(JSON.stringify({ type: 'thumb', id: m.id, v: m.v, data }));
      }
    };
    dc.onclose = () => { drop(id, peer); opts.onCancel?.(peer.code); };
  }
  function drop(id, peer) {
    if (peers.get(id) !== peer) return;
    peers.delete(id); close(peer); changed();
  }
  function close(p) { try { p.dc?.close(); } catch {} try { p.pc.close(); } catch {} }
  function changed() { opts.onChange?.(); }

  // Every state change of the player goes to every approved phone.
  function broadcast(state) {
    lastState = state;
    const s = JSON.stringify({ type: 'state', state });
    for (const p of peers.values()) if (p.approved && p.dc?.readyState === 'open') p.dc.send(s);
  }
  const connected = () => [...peers.values()].filter(p => p.approved && p.dc?.readyState === 'open').length;
  const pairUrl = name => `${APP_URL}#pair=${encodeURIComponent(secret)}&name=${encodeURIComponent(name || '')}`;

  return { start, stop, broadcast, connected, pairUrl, isRunning: () => running, isOnline: () => online };
})();
