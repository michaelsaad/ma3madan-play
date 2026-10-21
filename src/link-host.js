// The laptop side of the phone app (Ma3madan Remote, ma3madan-remote.pages.dev): while the phone
// remote is on, it watches the signaling server for paired phones and connects to each one
// directly over the Wi-Fi (a WebRTC data channel, see link.js). The phone gets the same state and
// sends the same commands as the Wi-Fi remote page served by remote.js.
const LinkHost = (() => {
  const APP_URL = 'https://ma3madan-remote.pages.dev/';
  let link = null, secret = null, running = false, cursor = 0, timer = null, opts = {}, online = null;
  let lastState = null;
  const peers = new Map(); // phone id → { pc, dc, device }

  async function start(key, options) {
    stop();
    secret = key; opts = options; running = true;
    link = await MaLink.deriveLink(key);
    // Offers left before we started are stale: begin after the newest message waiting.
    try { const old = await MaLink.receive(link, 'host', 0); cursor = old.length ? old[old.length - 1].id : 0; online = true; }
    catch { online = false; }
    loop();
  }
  function stop() {
    running = false;
    clearTimeout(timer);
    for (const p of peers.values()) close(p);
    peers.clear();
    changed();
  }
  async function loop() {
    if (!running) return;
    try {
      const msgs = await MaLink.receive(link, 'host', cursor);
      for (const m of msgs) {
        cursor = Math.max(cursor, m.id);
        if (m.msg?.type === 'offer' && Math.abs(Date.now() - m.msg.ts) < 60000) accept(m.from, m.msg).catch(e => console.warn('link', e));
      }
      if (online !== true) { online = true; changed(); }
    } catch {
      if (online !== false) { online = false; changed(); }
    }
    timer = setTimeout(loop, 2000);
  }
  async function accept(id, offer) {
    if (peers.has(id)) close(peers.get(id));
    const pc = new RTCPeerConnection({ iceServers: MaLink.ICE_SERVERS });
    const peer = { pc, dc: null, device: String(offer.device || 'Phone').slice(0, 20) };
    peers.set(id, peer);
    pc.ondatachannel = e => { peer.dc = e.channel; wire(id, peer, e.channel); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') drop(id, peer);
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await MaLink.gathered(pc);
    await MaLink.send(link, 'host', id, { type: 'answer', sdp: pc.localDescription.sdp, name: opts.name });
  }
  function wire(id, peer, dc) {
    dc.onopen = () => { if (lastState) dc.send(JSON.stringify({ type: 'state', state: lastState })); changed(); };
    dc.onmessage = async e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'cmd' && m.cmd && typeof m.cmd.action === 'string') opts.onCommand(m.cmd);
      else if (m.type === 'thumb' && typeof m.id === 'string') {
        const data = await opts.thumb(m.id);
        if (data && dc.readyState === 'open') dc.send(JSON.stringify({ type: 'thumb', id: m.id, v: m.v, data }));
      }
    };
    dc.onclose = () => drop(id, peer);
  }
  function drop(id, peer) {
    if (peers.get(id) !== peer) return;
    peers.delete(id); close(peer); changed();
  }
  function close(p) { try { p.dc?.close(); } catch {} try { p.pc.close(); } catch {} }
  function changed() { opts.onChange?.(); }

  // Every state change of the player goes to every connected phone.
  function broadcast(state) {
    lastState = state;
    const s = JSON.stringify({ type: 'state', state });
    for (const p of peers.values()) if (p.dc?.readyState === 'open') p.dc.send(s);
  }
  const connected = () => [...peers.values()].filter(p => p.dc?.readyState === 'open').length;
  const pairUrl = name => `${APP_URL}#pair=${encodeURIComponent(secret)}&name=${encodeURIComponent(name || '')}`;

  return { start, stop, broadcast, connected, pairUrl, isRunning: () => running, isOnline: () => online };
})();
