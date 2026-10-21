// Phone remote: a small web page served on the local network, so the operator can walk around
// with a phone and still change videos, pause, or put up the standby screen.
//
// - Off until the operator turns it on. Only phones on the same Wi-Fi can reach it.
// - Every request needs the secret key from the QR code (?k=…); without it nothing is served.
// - The page gets the state as Server-Sent Events and sends commands as small POSTs, which the
//   control window carries out exactly like its own buttons.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const qrcode = require('./vendor/qrcode');

let server = null;
let port = 0;
let key = '';
let onCommand = () => {};
let thumbPath = () => null;   // item id → thumbnail file, if any
let state = {};
const clients = new Set();

// Wi-Fi / Ethernet addresses a phone could reach (private ranges first).
function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^169\.254\./.test(a.address)) continue; // no network (self-assigned)
      const isPrivate = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const isVirtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Bluetooth/i.test(name);
      list.push({ address: a.address, name, rank: (isPrivate ? 0 : 2) + (isVirtual ? 1 : 0) });
    }
  }
  return list.sort((a, b) => a.rank - b.rank).map(({ address, name }) => ({ address, name }));
}

function info() {
  if (!server) return { on: false };
  const addrs = lanAddresses();
  const urls = addrs.map(a => `http://${a.address}:${port}/?k=${key}`);
  let qr = null;
  if (urls[0]) {
    const q = qrcode(0, 'M');
    q.addData(urls[0]);
    q.make();
    qr = q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
  }
  return { on: true, port, urls, names: addrs.map(a => a.name), qr, clients: clients.size };
}

const page = () => fs.readFileSync(path.join(__dirname, 'remote.html'));
const authorized = url => url.searchParams.get('k') === key;

function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (!authorized(url)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Scan the QR code in Ma3madan Play again.');
  }
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page());
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); onCommand({ action: 'clients' }); });
    onCommand({ action: 'clients' });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/logo.png') {
    res.writeHead(200, { ...headers, 'Cache-Control': 'max-age=86400', 'Content-Type': 'image/png' });
    return fs.createReadStream(path.join(__dirname, 'assets', 'app-128.png')).pipe(res);
  }
  if (req.method === 'GET' && url.pathname.startsWith('/thumb/')) {
    const file = thumbPath(decodeURIComponent(url.pathname.slice(7)));
    if (!file || !fs.existsSync(file)) { res.writeHead(404, headers); return res.end(); }
    res.writeHead(200, { ...headers, 'Cache-Control': 'max-age=3600', 'Content-Type': 'image/jpeg' });
    return fs.createReadStream(file).pipe(res);
  }
  if (req.method === 'POST' && url.pathname === '/cmd') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      try { onCommand(JSON.parse(body)); res.writeHead(204, headers); }
      catch { res.writeHead(400, headers); }
      res.end();
    });
    return;
  }
  res.writeHead(404, headers);
  res.end();
}

function start(opts) {
  if (server) return Promise.resolve(info());
  key = opts.key || crypto.randomBytes(9).toString('base64url');
  onCommand = opts.onCommand || onCommand;
  thumbPath = opts.thumbPath || thumbPath;
  return new Promise((resolve, reject) => {
    const s = http.createServer(handle);
    const listen = p => s.listen(p, '0.0.0.0');
    s.once('listening', () => { server = s; port = s.address().port; resolve(info()); });
    s.on('error', e => {
      // The usual port is taken: any free port will do (the QR code carries it).
      if (e.code === 'EADDRINUSE' && opts.port) { opts.port = 0; listen(0); } else reject(e);
    });
    listen(opts.port || 0);
  });
}

function stop() {
  for (const c of clients) c.end();
  clients.clear();
  server?.close();
  server = null;
}

// The control window sends its state whenever it changes; phones get it right away.
function setState(s) {
  state = s;
  const msg = `data: ${JSON.stringify(s)}\n\n`;
  for (const c of clients) c.write(msg);
}

// An SVG QR code for any text (the phone app's pairing link).
function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 3, scalable: true });
}

module.exports = { start, stop, info, setState, qrSvg, key: () => key };
