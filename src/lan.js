// The phone remote with no internet at all: the same phone app (Ma3madan Remote, a copy in
// src/phone/), served by this computer on the local network. Run by the hub (hub.js) for both apps.
//
// - Only while the phone remote is on, and only for phones on the same Wi-Fi.
// - The QR code carries a secret key (?k=…). The first page load trades it for a cookie, so the
//   key doesn't stay in the address; every request without it gets nothing.
// - The page gets its messages as Server-Sent Events and sends its own as small POSTs: the same
//   messages as over WebRTC, so the hub treats a Wi-Fi page like any other phone.
//
// The same file is used by both apps (copy it: ma3madan-play/src/lan.js → ma3madan-ppt/src/lan.js).
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const qrcode = require('./vendor/qrcode');

const PORT = 8790;
const MAX_PAGES = 12;
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/link.js': ['link.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
};
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|::ffff:(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)|f[cd]|fe80:)/i;

// Wi-Fi / Ethernet addresses a phone could reach (real private networks first; VPNs and virtual
// adapters last).
function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^169\.254\./.test(a.address)) continue; // no network (self-assigned)
      const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const isVirtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Bluetooth|Tailscale|ZeroTier|WireGuard|OpenVPN|TAP-|Radmin|Hamachi/i.test(name);
      // 100.64/10 is carrier and VPN space (Tailscale): a phone on the Wi-Fi can't reach it.
      const isCgnat = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address);
      // Windows' Mobile Hotspot is always 192.168.137.1: phones on this computer's own hotspot.
      const hotspot = /^192\.168\.137\.1$/.test(a.address);
      list.push({ address: a.address, name, hotspot, rank: (isPrivate ? 0 : 2) + (isVirtual || isCgnat ? 1 : 0) });
    }
  }
  const sorted = list.sort((a, b) => a.rank - b.rank);
  // Virtual adapters (Hyper-V, WSL, VPNs) only when there's nothing else: no phone is on them.
  const real = sorted.filter(a => a.rank % 2 === 0);
  return (real.length ? real : sorted).map(({ address, name, hotspot }) => ({ address, name, hotspot }));
}

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
}

// options: { dir: the phone app's files, onMessage(peer, msg), onJoin(peer), onLeave(peer) }
function createLan(options) {
  let server = null, port = 0, key = '';
  const pages = new Map(); // peer → res (the open event stream)

  const sameKey = k => {
    const a = Buffer.from(String(k || '')), b = Buffer.from(key);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const cookieKey = req => (/(?:^|;\s*)mk=([\w-]+)/.exec(req.headers.cookie || '') || [])[1];
  const headers = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'",
  };
  const deny = (res, code, text) => { res.writeHead(code, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }); res.end(text || ''); };

  function handle(req, res) {
    // Phones on this network only; and a plain address as the host (no other site's name
    // pointing here: "DNS rebinding").
    if (!PRIVATE.test(req.socket.remoteAddress || '')) return deny(res, 403);
    if (!/^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|localhost)(:\d+)?$/i.test(req.headers.host || '')) return deny(res, 400);
    const url = new URL(req.url, 'http://lan');
    // First visit from the QR code: the key becomes a cookie, and the address loses it.
    if (url.searchParams.has('k')) {
      if (!sameKey(url.searchParams.get('k'))) return deny(res, 403, 'Scan the QR code on the computer again.');
      res.writeHead(302, { ...headers, 'Set-Cookie': `mk=${key}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`, Location: '/' });
      return res.end();
    }
    if (!sameKey(cookieKey(req))) return deny(res, 403, 'Scan the QR code on the computer again.');

    if (req.method === 'GET' && FILES[url.pathname]) {
      const [file, type] = FILES[url.pathname];
      res.writeHead(200, { ...headers, 'Content-Type': type });
      return res.end(fs.readFileSync(path.join(options.dir, file)));
    }
    if (req.method === 'GET' && /^\/icons\/[\w-]+\.png$/.test(url.pathname)) {
      const file = path.join(options.dir, 'icons', path.basename(url.pathname));
      if (!fs.existsSync(file)) return deny(res, 404);
      res.writeHead(200, { ...headers, 'Cache-Control': 'max-age=86400', 'Content-Type': 'image/png' });
      return res.end(fs.readFileSync(file));
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      if (pages.size >= MAX_PAGES) return deny(res, 429);
      const peer = 'lan-' + crypto.randomBytes(6).toString('base64url');
      res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(`event: peer\ndata: ${JSON.stringify(peer)}\n\n`);
      pages.set(peer, res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(ping); if (pages.get(peer) === res) { pages.delete(peer); options.onLeave(peer); } });
      options.onJoin(peer);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/msg') {
      const peer = url.searchParams.get('peer') || '';
      if (!pages.has(peer)) return deny(res, 410);
      let body = '';
      req.setEncoding('utf8');
      req.on('data', d => { body += d; if (body.length > 64 * 1024) req.destroy(); });
      req.on('end', () => {
        let m = null;
        try { m = JSON.parse(body); } catch {}
        if (!m || typeof m !== 'object') return deny(res, 400);
        res.writeHead(204, headers); res.end();
        if (m.type === 'ping') send(peer, { type: 'pong' });
        else if (typeof m.app === 'string' && typeof m.type === 'string') options.onMessage(peer, m);
      });
      return;
    }
    deny(res, 404);
  }

  function start(withKey) {
    if (server) return Promise.resolve(info());
    key = withKey;
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        // A broken request must never take the app down.
        try { handle(req, res); } catch { try { deny(res, 400); } catch {} }
      });
      s.on('clientError', (_e, sock) => { try { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {} });
      const listen = p => s.listen(p, '0.0.0.0');
      s.once('listening', () => { server = s; port = s.address().port; resolve(info()); });
      s.on('error', e => {
        // The usual port is taken: any free port will do (the QR code carries it).
        if (e.code === 'EADDRINUSE' && !port) { port = -1; listen(0); } else if (!server) reject(e);
      });
      listen(PORT);
    });
  }
  function stop() {
    for (const res of pages.values()) { try { res.end(); } catch {} }
    pages.clear();
    server?.close(); server = null; port = 0;
  }
  // One entry per network: a phone scans the code of the network it's on (this computer's
  // Wi-Fi, or the hotspot it shares with phones).
  function info() {
    if (!server) return { on: false };
    const nets = lanAddresses().map(a => {
      const url = `http://${a.address}:${port}/?k=${key}`;
      return { name: a.name, hotspot: a.hotspot, address: a.address, url, qr: qrSvg(url) };
    });
    return { on: true, nets, urls: nets.map(n => n.url), qr: nets[0]?.qr || null, pages: pages.size };
  }
  // To one Wi-Fi page (peer), or to all of them (null).
  function send(peer, msg) {
    const data = `data: ${JSON.stringify(msg)}\n\n`;
    if (peer) { pages.get(peer)?.write(data); return; }
    for (const res of pages.values()) res.write(data);
  }
  const has = peer => pages.has(peer);
  return { start, stop, info, send, has, count: () => pages.size };
}

module.exports = { createLan, qrSvg, lanAddresses };
