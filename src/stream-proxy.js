// Local HTTP proxy for YouTube streams.
//
// A <video> element asks for "bytes=N-" in one request, and YouTube throttles that kind of request
// to roughly playback speed, so any network hiccup becomes a stall. yt-dlp avoids this by fetching
// in chunks with the `&range=` parameter; this proxy does the same and serves the result to the
// player as one seekable file.
const http = require('http');
const crypto = require('crypto');

const FIRST_CHUNK = 1 << 20; // small first piece so playback starts quickly
const CHUNK = 8 << 20;
const RETRIES = 2;

const targets = new Map(); // token -> { url, headers, size, type }
let port = 0;

// ---------- connection speed ----------
// Measured only while data is actually arriving from YouTube: when the player's buffer is full it
// stops reading, the proxy stops fetching, and that idle time must not count as a slow connection.
// The output window reads it from /stats to decide when a higher quality can keep up.
let active = 0;              // transfers currently pulling data
let activeSince = 0;
let activeMs = 0, bytes = 0; // since the last sample
let bps = 0;                 // smoothed bits per second (0 = not measured yet)
let samples = 0;
let measuredAt = 0;
let testLimit = 0, limitFreeAt = 0;
let openResponses = 0;
const sleepers = new Set();
const startActive = () => { if (active++ === 0) activeSince = Date.now(); };
const stopActive = () => { if (--active === 0) activeMs += Date.now() - activeSince; };
setInterval(() => {
  const now = Date.now();
  let ms = activeMs;
  if (active) { ms += now - activeSince; activeSince = now; }
  if (ms > 250 && bytes > 64 * 1024) {
    const sample = (bytes * 8 * 1000) / ms;
    bps = bps ? bps * 0.7 + sample * 0.3 : sample;
    samples++; measuredAt = now;
  }
  activeMs = 0; bytes = 0;
}, 1000).unref();

async function fetchChunk(target, from, to, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(`${target.url}&range=${from}-${to}`, { headers: target.headers, signal });
      if (r.ok) return r;
      throw new Error('upstream ' + r.status);
    } catch (e) {
      // 4xx means the link expired or was refused; retrying won't help.
      if (signal.aborted || attempt >= RETRIES || /upstream 4/.test(e.message)) throw e;
      await new Promise(ok => setTimeout(ok, 500 * (attempt + 1)));
    }
  }
}

// Waits for the player to take more data (or go away), without leaving listeners behind.
function drained(res) {
  return new Promise(ok => {
    const done = () => { res.off('drain', done); res.off('close', done); ok(); };
    res.on('drain', done);
    res.on('close', done);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(lastSpeed()));
  }
  const target = targets.get(req.url.slice(1));
  if (!target) { res.writeHead(404); return res.end(); }

  const { size } = target;
  let start = 0, end = size - 1;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    if (range[1]) start = Number(range[1]);
    if (range[2]) end = Math.min(Number(range[2]), size - 1);
  }
  if (start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }

  res.writeHead(range ? 206 : 200, {
    'Content-Type': target.type,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  });
  if (req.method === 'HEAD') return res.end();

  const abort = new AbortController();
  openResponses++;
  res.on('close', () => { openResponses--; abort.abort(); });
  let pos = start, first = true;
  try {
    while (pos <= end && !abort.signal.aborted) {
      const to = Math.min(pos + (first ? FIRST_CHUNK : CHUNK) - 1, end);
      first = false;
      startActive();
      let pulling = true;
      try {
        const upstream = await fetchChunk(target, pos, to, abort.signal);
        for await (const chunk of upstream.body) {
          if (abort.signal.aborted) break;
          pos += chunk.length; bytes += chunk.length;
          // Self-test only: act like a slow connection (bits per second).
          if (testLimit) {
            // One limit shared by all transfers, like a real slow line.
            const now = Date.now();
            limitFreeAt = Math.max(limitFreeAt, now) + (chunk.length * 8 * 1000) / testLimit;
            await new Promise(ok => {
              const wake = () => { clearTimeout(timer); sleepers.delete(wake); ok(); };
              const timer = setTimeout(wake, limitFreeAt - now);
              sleepers.add(wake);
            });
          }
          if (!res.write(chunk)) {
            // The player is full: waiting here is not network time.
            stopActive(); pulling = false;
            await drained(res);
            startActive(); pulling = true;
          }
        }
      } finally {
        if (pulling) stopActive();
      }
    }
    res.end();
  } catch {
    res.destroy();
  }
});

// The smoothed speed and how old it is, so the player (and the next stream) can pick a quality.
function lastSpeed() {
  return { bps: Math.round(bps), samples, age: measuredAt ? Date.now() - measuredAt : null, open: openResponses };
}

function start() {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); }));
}

// Returns a local URL for a yt-dlp format, or the original URL when its size is unknown.
function proxyUrl(fmt) {
  const size = Number(fmt.filesize) || Number(new URL(fmt.url).searchParams.get('clen')) || 0;
  if (!size || !port) return fmt.url;
  const isVideo = fmt.vcodec && fmt.vcodec !== 'none';
  const type = `${isVideo ? 'video' : 'audio'}/${fmt.ext === 'webm' ? 'webm' : 'mp4'}`;
  const token = crypto.randomUUID();
  targets.set(token, { url: fmt.url, headers: fmt.http_headers || {}, size, type });
  return `http://127.0.0.1:${port}/${token}`;
}

// Self-test only: limit the speed, like a slow connection (0 = no limit).
const setTestLimit = bps => {
  testLimit = bps; limitFreeAt = 0;
  if (!bps) for (const wake of [...sleepers]) wake();
};

module.exports = { start, proxyUrl, lastSpeed, setTestLimit };
