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
  res.on('close', () => abort.abort());
  let pos = start, first = true;
  try {
    while (pos <= end && !abort.signal.aborted) {
      const to = Math.min(pos + (first ? FIRST_CHUNK : CHUNK) - 1, end);
      first = false;
      const upstream = await fetchChunk(target, pos, to, abort.signal);
      for await (const chunk of upstream.body) {
        if (abort.signal.aborted) break;
        pos += chunk.length;
        if (!res.write(chunk)) await drained(res);
      }
    }
    res.end();
  } catch {
    res.destroy();
  }
});

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

module.exports = { start, proxyUrl };
