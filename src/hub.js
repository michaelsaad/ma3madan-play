// One phone link for both computer apps (Ma3madan Play and Ma3madan PPT).
//
// The first app to turn the phone remote on becomes the hub: its page holds the WebRTC link to
// the phones (link-host.js), and this file, in its main process, hands each phone message to the
// app it's for. The other app joins the hub over a named pipe (only this Windows user can reach
// it, and it must know the link's secret). So a phone has one connection, one QR code, one
// "Trust" and one "Forget" for the computer, and sees a tab for each app that's open. When the
// hub app closes or turns the remote off, the other one takes over by itself and the phones
// reconnect to it.
//
// The computer's identity is shared by both apps: %APPDATA%\Ma3madan\link.json (the room id, the
// room's secret, the QR pairing code, and the trusted phones with their keys).
//
// The same file is used by both apps (copy it: ma3madan-play/src/hub.js → ma3madan-ppt/src/hub.js).
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app: electronApp, ipcMain } = require('electron');
const { createLan } = require('./lan');

const BASE = process.env.MA3MADAN_BASE || 'https://ma3madan-remote.pages.dev';
const rid = (bytes = 12) => crypto.randomBytes(bytes).toString('base64url');
const PIPE = `\\\\.\\pipe\\ma3madan-link-${process.env.MA3MADAN_PIPE || (os.userInfo().username || 'user').replace(/[^\w-]/g, '_')}`;

// ---------- the shared identity ----------
// (MA3MADAN_LINK_DIR: tests with both apps share a throwaway one.)
const idFile = () => path.join(process.env.MA3MADAN_LINK_DIR || path.join(electronApp.getPath('appData'), 'Ma3madan'), 'link.json');
function readIdentity() {
  try {
    const j = JSON.parse(fs.readFileSync(idFile(), 'utf8'));
    if (j.hostId && j.auth && j.pairCode) return { devices: {}, lanKey: null, ...j };
  } catch {}
  return null;
}
function writeIdentity(j) {
  const f = idFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
  fs.renameSync(tmp, f);
}
// Every trusted phone gets a fun name of its own ("Swift Falcon"); rename it in the Remote panel.
const NAME_A = ['Swift', 'Brave', 'Silent', 'Golden', 'Lucky', 'Rapid', 'Cosmic', 'Mighty', 'Clever', 'Sunny', 'Shadow', 'Thunder', 'Crimson', 'Jolly', 'Sneaky', 'Turbo', 'Royal', 'Night', 'Wild', 'Happy'];
const NAME_B = ['Falcon', 'Tiger', 'Panda', 'Eagle', 'Fox', 'Lion', 'Owl', 'Wolf', 'Dolphin', 'Rocket', 'Ninja', 'Comet', 'Hawk', 'Bear', 'Phoenix', 'Shark', 'Pilot', 'Ranger', 'Wizard', 'Captain'];
function funName(taken) {
  const pick = a => a[crypto.randomInt(a.length)];
  for (let i = 0; i < 50; i++) { const n = pick(NAME_A) + ' ' + pick(NAME_B); if (!taken.has(n)) return n; }
  return pick(NAME_A) + ' ' + pick(NAME_B) + ' ' + crypto.randomInt(2, 99);
}
const fresh = () => ({ hostId: 'm-' + rid(12), auth: rid(24), pairCode: rid(12), lanKey: rid(12), devices: {} });
function identity() {
  let j = readIdentity();
  if (!j) { j = fresh(); writeIdentity(j); }
  if (!j.lanKey) { j.lanKey = rid(12); writeIdentity(j); }
  return j;
}

// ---------- the hub ----------
// options: { app: 'play'|'ppt', title: 'Ma3madan Play', version, window: () => BrowserWindow|null,
//            computerName: () => string, phoneDir: the phone app's files for the Wi-Fi page (lan.js) }
function createHub(options) {
  const me = options.app;
  // Tests (a test pipe) show up as "<name> (test)" in Nearby, never as the real computer.
  const computerName = () => options.computerName() + (process.env.MA3MADAN_PIPE ? ' (test)' : '');
  const page = () => { const w = options.window(); return w && !w.isDestroyed() ? w.webContents : null; };
  const toPage = (ch, msg) => page()?.send(ch, msg);
  let on = false, role = 'off', server = null, upstream = null;
  const clients = new Set();                // hub: other apps' pipes { sock, app, title, version }
  const lastState = new Map();              // hub: app → its latest state, for phones that join
  let peers = [], online = null, hostReady = false;
  let status = {};                          // client: the hub's status
  const waiting = new Map(); let opId = 0;  // client: ops sent to the hub
  // The Wi-Fi page (no internet needed), served by the hub: its pages are phones like the others.
  const lan = createLan({
    dir: options.phoneDir,
    onJoin: peer => { lan.send(peer, { type: 'hello', name: computerName(), hostId: identity().hostId, apps: appNames() }); fromNet(peer, { type: 'joined' }); pushStatus(); },
    onLeave: () => pushStatus(),
    onMessage: (peer, msg) => fromNet(peer, msg),
  });
  const startLan = () => lan.start(identity().lanKey).then(pushStatus).catch(e => { console.warn('wifi page', e.message); pushStatus(); });
  // A network came or went (a hotspot turned on, another Wi-Fi): new addresses for the Wi-Fi page.
  let netKey = '';
  setInterval(() => {
    if (role !== 'hub') return;
    const k = JSON.stringify(require('os').networkInterfaces());
    if (k !== netKey) { const first = !netKey; netKey = k; if (!first) pushStatus(); }
  }, 4000);

  // ---------- pipe framing: one JSON per line ----------
  function lines(sock, fn) {
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        fn(m);
      }
    });
  }
  const write = (sock, obj) => { try { if (!sock.destroyed) sock.write(JSON.stringify(obj) + '\n'); } catch {} };

  // ---------- on / off ----------
  function start() { if (on) return; on = true; claim(); }
  function stop() {
    if (!on) return;
    on = false;
    becomeOff();
    pushStatus();
  }
  function becomeOff() {
    if (role === 'hub') {
      // Off the phones' "nearby" list at once, unless the other app is about to take over.
      const j = readIdentity();
      if (j && !clients.size) {
        fetch(`${BASE}/api/presence`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ host: j.hostId, auth: j.auth, leave: true }) }).catch(() => {});
      }
      toPage('link-host-stop');
      for (const c of clients) c.sock.destroy(); // they take over
      clients.clear();
      server?.close(); server = null;
      lan.stop();
      lastState.clear(); peers = []; online = null; hostReady = false;
    } else if (role === 'client') {
      upstream?.removeAllListeners('close'); upstream?.destroy(); upstream = null;
    }
    role = 'off';
  }

  // Be the hub if nobody is; else join it.
  function claim() {
    if (!on || role !== 'off') return;
    const srv = net.createServer(sock => welcome(sock));
    srv.once('error', e => {
      if (e.code === 'EADDRINUSE') join();
      else { console.warn('hub', e.message); setTimeout(claim, 2000); }
    });
    srv.listen(PIPE, () => {
      if (!on) { srv.close(); return; }
      server = srv; role = 'hub';
      toPage('link-host-start', { identity: hostIdentity(), apps: appNames() });
      startLan();
      pushStatus();
    });
  }
  function join() {
    if (!on || role !== 'off') return;
    const sock = net.connect(PIPE);
    sock.once('error', () => { sock.destroy(); retryClaim(); });
    sock.once('connect', () => {
      upstream = sock; role = 'client';
      write(sock, { type: 'register', auth: identity().auth, app: me, title: options.title, version: options.version });
      lines(sock, fromHub);
      sock.on('close', () => { upstream = null; role = 'off'; status = {}; pushStatus(); retryClaim(); });
      pushStatus();
    });
  }
  // A short random wait, so two apps don't both try to take over at the same moment.
  function retryClaim() { if (on) setTimeout(() => { if (on && role === 'off') claim(); }, 100 + Math.random() * 400); }

  // ---------- hub: the other app ----------
  function welcome(sock) {
    const c = { sock, app: null };
    const timer = setTimeout(() => sock.destroy(), 3000); // must say who it is first
    lines(sock, m => {
      if (!c.app) {
        if (m.type !== 'register' || m.auth !== identity().auth || !['play', 'ppt'].includes(m.app) || m.app === me) { sock.destroy(); return; }
        clearTimeout(timer);
        Object.assign(c, { app: m.app, title: m.title, version: m.version });
        for (const x of clients) if (x.app === c.app) x.sock.destroy(); // a restarted app
        clients.add(c);
        appsChanged();
        return;
      }
      if (m.type === 'out') fromApp(c.app, m.msg);
      else if (m.type === 'op') Promise.resolve(op(m.op)).then(result => write(sock, { type: 'op-reply', id: m.id, result }));
    });
    sock.on('error', () => {});
    sock.on('close', () => { clearTimeout(timer); if (clients.delete(c)) { lastState.delete(c.app); appsChanged(); } });
  }
  const appNames = () => [...(on ? [me] : []), ...[...clients].map(c => c.app)];
  function appsChanged() {
    toPage('link-host-apps', appNames());
    sendNet(null, { type: 'apps', apps: appNames() });
    pushStatus();
  }

  // ---------- routing ----------
  // From an app (this one or the other): its state for every phone, or an answer for one phone.
  function fromApp(app, msg) {
    if (role === 'client') { write(upstream, { type: 'out', msg }); return; }
    if (role !== 'hub' || !msg || typeof msg !== 'object') return;
    const tagged = { ...msg, app };
    delete tagged.peer;
    if (msg.type === 'state') lastState.set(app, msg.state);
    sendNet(msg.peer || null, tagged);
  }
  function sendNet(peer, msg) {
    if (role !== 'hub') return;
    if (peer?.startsWith('lan-')) { lan.send(peer, msg); return; }
    if (!peer) lan.send(null, msg);
    if (hostReady) toPage('link-host-send', { peer, msg });
  }
  // From a phone (through this page's link-host.js): to the app it's for.
  function fromNet(peer, msg) {
    if (msg.type === 'joined') {
      for (const [app, state] of lastState) sendNet(peer, { app, type: 'state', state });
      return;
    }
    if (msg.type === 'left') return;
    const out = { ...msg, peer };
    if (msg.app === me) toPage('link-app-in', out);
    else for (const c of clients) if (c.app === msg.app) write(c.sock, { type: 'in', msg: out });
  }
  // client: what the hub sends.
  function fromHub(m) {
    if (m.type === 'in') toPage('link-app-in', m.msg);
    else if (m.type === 'status') { status = m.status; pushStatus(); }
    else if (m.type === 'op-reply') { waiting.get(m.id)?.(m.result); waiting.delete(m.id); }
  }

  // ---------- trusted phones and the QR code ----------
  function hostIdentity() {
    const j = identity();
    return { hostId: j.hostId, auth: j.auth, pairCode: j.pairCode, name: computerName(), devices: Object.fromEntries(Object.entries(j.devices).map(([k, d]) => [k, { key: d.key, name: d.name }])) };
  }
  function identityChanged() { if (role === 'hub') toPage('link-host-identity', hostIdentity()); pushStatus(); }
  // Ops from either app's Remote panel (the other app asks the hub).
  function op(o = {}) {
    const j = identity();
    if (o.op === 'trust') {
      // A phone was just trusted: its own key, and a new QR code (the old one was used).
      const deviceId = 'd-' + rid(9), key = rid(32);
      const name = funName(new Set(Object.values(j.devices).map(d => d.name)));
      j.devices[deviceId] = { key, name, model: String(o.device || '').slice(0, 24), added: Date.now(), seen: Date.now() };
      j.pairCode = rid(12);
      writeIdentity(j); identityChanged();
      return { deviceId, key };
    }
    if (o.op === 'seen' && j.devices[o.id]) { j.devices[o.id].seen = Date.now(); writeIdentity(j); pushStatus(); return true; }
    if (o.op === 'rename' && j.devices[o.id]) { j.devices[o.id].name = String(o.name || '').slice(0, 24) || j.devices[o.id].name; writeIdentity(j); identityChanged(); return true; }
    if (o.op === 'forget') { delete j.devices[o.id]; writeIdentity(j); identityChanged(); return true; }
    if (o.op === 'forgetAll') {
      // Every phone out, and a new room: an old QR code or a copied key leads nowhere.
      writeIdentity(fresh());
      if (role === 'hub') { toPage('link-host-stop'); toPage('link-host-start', { identity: hostIdentity(), apps: appNames() }); lan.stop(); startLan(); }
      pushStatus();
      return true;
    }
    if (o.op === 'newCode') { j.pairCode = rid(12); writeIdentity(j); identityChanged(); return true; }
    return false;
  }
  function ask(o) {
    if (role === 'hub' || role === 'off') return Promise.resolve(op(o));
    return new Promise(resolve => { const id = ++opId; waiting.set(id, resolve); write(upstream, { type: 'op', id, op: o }); setTimeout(() => { if (waiting.delete(id)) resolve(false); }, 5000); });
  }

  // ---------- status, for the Remote panels of both apps ----------
  function hubStatus() {
    const j = identity();
    const pairUrl = `${BASE}/#pair=${encodeURIComponent(j.hostId + '.' + j.pairCode)}&name=${encodeURIComponent(computerName())}`;
    return {
      online, pairUrl, hub: options.title, apps: appNames(),
      phones: peers.map(p => ({ device: p.device, deviceId: p.deviceId, route: p.route })),
      wifiPages: lan.count(), lan: lan.info(),
      devices: Object.entries(j.devices).map(([id, d]) => ({ id, name: d.name, added: d.added, seen: d.seen, connected: peers.some(p => p.deviceId === id) })),
    };
  }
  function pushStatus() {
    let s;
    if (!on) s = { on: false, role: 'off' };
    else if (role === 'hub') { s = { on: true, role, ...hubStatus() }; for (const c of clients) write(c.sock, { type: 'status', status: s }); }
    else if (role === 'client') s = { on: true, role, ...status, role: 'client' };
    else s = { on: true, role: 'starting' };
    toPage('link-status', s);
  }

  // ---------- this app's page ----------
  ipcMain.on('link-app-out', (e, msg) => { if (e.sender === page()) fromApp(me, msg); });
  ipcMain.on('link-host-net', (e, { peer, msg }) => { if (e.sender === page() && role === 'hub' && msg && typeof msg === 'object') fromNet(peer, msg); });
  ipcMain.on('link-host-peers', (e, list) => { if (e.sender === page()) { peers = Array.isArray(list) ? list : []; pushStatus(); } });
  ipcMain.on('link-host-online', (e, v) => { if (e.sender === page()) { online = !!v; hostReady = true; pushStatus(); } });
  ipcMain.handle('link-op', (e, o) => (e.sender === page() ? ask(o) : false));
  ipcMain.handle('link-host-trust', (e, o) => (e.sender === page() && role === 'hub' ? op({ op: 'trust', device: o?.device }) : null));
  ipcMain.on('link-host-seen', (e, id) => { if (e.sender === page() && role === 'hub') op({ op: 'seen', id }); });
  ipcMain.handle('link-status', () => { setTimeout(pushStatus, 0); return true; });

  // The page was reloaded (or loaded late): give the link back to it.
  function pageReady() {
    if (role === 'hub') { hostReady = false; toPage('link-host-start', { identity: hostIdentity(), apps: appNames() }); }
    pushStatus();
  }

  return { start, stop, pageReady, isOn: () => on, role: () => role };
}

module.exports = { createHub, PIPE };
