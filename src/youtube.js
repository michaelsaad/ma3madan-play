// YouTube support through yt-dlp: downloading to disk, and resolving stream URLs.
//
// Neither tool is bundled with the installer; each is fetched the first time it's needed, checked
// against a SHA-256 hash, and kept in userData/bin:
// - yt-dlp, on first YouTube use, from its official release (hash from the release's SHA2-256SUMS).
//   Keeping it in userData lets `yt-dlp -U` update it in place.
// - FFmpeg, only for "Download as MP3", from a pinned ffmpeg-static build (hashes pinned below).
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { proxyUrl } = require('./stream-proxy');

const binPath = name => path.join(app.getPath('userData'), 'bin', name);

const YTDLP_RELEASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const FFMPEG = {
  url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz',
  gzSha256: '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
  exeSha256: '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
};

// onSetupProgress(tool, fraction) drives the "Setting up…" toast in the control window.
let onSetupProgress = () => {};
function setSetupListener(fn) { onSetupProgress = fn; }

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

async function fetchWithProgress(url, tool) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${tool} download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0, lastPct = -1;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    received += chunk.length;
    const pct = total ? Math.floor((received / total) * 100) : 0;
    if (pct !== lastPct && pct < 100) { lastPct = pct; onSetupProgress(tool, pct / 100); }
  }
  return Buffer.concat(chunks);
}

function install(name, data) {
  const target = binPath(name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target + '.part', data);
  fs.renameSync(target + '.part', target);
  return target;
}

const installing = new Map(); // tool -> pending install
function ensureTool(tool, name, installer) {
  if (fs.existsSync(binPath(name))) return Promise.resolve(binPath(name));
  if (!installing.has(tool)) {
    installing.set(tool, (async () => {
      onSetupProgress(tool, 0);
      const target = await installer();
      onSetupProgress(tool, 1);
      return target;
    })().finally(() => installing.delete(tool)));
  }
  return installing.get(tool);
}

const ensureYtdlp = () => ensureTool('ytdlp', 'yt-dlp.exe', async () => {
  const sums = await fetch(YTDLP_RELEASE + 'SHA2-256SUMS').then(r => (r.ok ? r.text() : ''));
  const expected = sums.split('\n').map(l => l.trim().split(/\s+/)).find(([, name]) => name === 'yt-dlp.exe')?.[0];
  if (!expected) throw new Error("Couldn't reach GitHub to set up YouTube support");
  const exe = await fetchWithProgress(YTDLP_RELEASE + 'yt-dlp.exe', 'ytdlp');
  if (sha256(exe) !== expected.toLowerCase()) throw new Error('yt-dlp failed its checksum check');
  return install('yt-dlp.exe', exe);
});

const ensureFfmpeg = () => ensureTool('ffmpeg', 'ffmpeg.exe', async () => {
  const gz = await fetchWithProgress(FFMPEG.url, 'ffmpeg');
  if (sha256(gz) !== FFMPEG.gzSha256) throw new Error('FFmpeg failed its checksum check');
  const exe = zlib.gunzipSync(gz);
  if (sha256(exe) !== FFMPEG.exeSha256) throw new Error('FFmpeg failed its checksum check');
  return install('ffmpeg.exe', exe);
});

// YouTube needs a JavaScript runtime to solve its player challenges; Electron itself can act as Node.
const baseArgs = () => [
  '--no-playlist', '--encoding', 'utf-8',
  '--js-runtimes', 'node:' + process.execPath,
  '-S', 'res:1080,vcodec:h264,ext:mp4:m4a',
];
const env = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
const runYtdlp = async args => spawn(await ensureYtdlp(), args, { windowsHide: true, env: env() });

function lastError(stderr, code) {
  const lines = stderr.split(/\r?\n/);
  const msg = lines.filter(l => /ERROR/.test(l)).pop() || lines.filter(Boolean).pop() || `exit ${code}`;
  return msg.replace(/^ERROR:\s*/, '');
}

// ---------- downloads ----------
// kind 'video': picture and sound are saved as two files (Title.mp4 + Title.m4a) and played together,
// which avoids shipping FFmpeg just to merge them.
// kind 'mp3': the sound only, converted to MP3 with FFmpeg (fetched on first use).
const downloads = new Map(); // id -> child process
const canceled = new Set();

// onUpdate receives { status, title?, percent?, speed?, eta?, path?, audioPath?, error? }
async function download(id, url, outDir, kind, onUpdate) {
  fs.mkdirSync(outDir, { recursive: true });
  onUpdate({ status: 'starting' });
  const mp3 = kind === 'mp3';
  let proc;
  try {
    const format = mp3
      ? ['-f', 'ba', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--ffmpeg-location', await ensureFfmpeg()]
      : ['-f', 'bv,ba'];
    proc = await runYtdlp([
      url, ...baseArgs(),
      ...format,
      '-o', path.join(outDir, '%(title).120B [%(id)s].%(ext)s'),
      '--newline', '--progress', '--no-simulate',
      '--progress-template', 'download:PROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print', 'before_dl:TITLE|%(title)s',
      '--print', 'after_move:FILE|%(vcodec)s|%(filepath)s',
    ]);
  } catch (e) {
    return onUpdate({ status: 'error', error: e.message });
  }
  if (canceled.delete(id)) { proc.kill(); return onUpdate({ status: 'canceled' }); }
  downloads.set(id, proc);

  let title = null, video = null, audio = null, stderr = '', buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('TITLE|')) { title = line.slice(6).trim(); onUpdate({ title }); }
      else if (line.startsWith('FILE|')) {
        const [, vcodec, ...rest] = line.split('|');
        if (vcodec === 'none') audio = rest.join('|').trim(); else video = rest.join('|').trim();
      } else if (line.startsWith('PROG|')) {
        const [, pct, speed, eta] = line.split('|');
        const p = parseFloat(pct);
        // For video, the picture comes first and is most of the size; the sound fills the last 15%.
        // For MP3, the last 10% is left for the conversion.
        const percent = mp3 ? p * 0.9 : video ? 85 + p * 0.15 : p * 0.85;
        if (!isNaN(p)) onUpdate({ status: 'downloading', percent, speed: speed?.trim(), eta: eta?.trim() });
      }
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', d => { stderr += d; });
  proc.on('error', e => onUpdate({ status: 'error', error: e.message }));
  proc.on('close', code => {
    downloads.delete(id);
    if (proc.canceled) onUpdate({ status: 'canceled' });
    else if (code === 0 && mp3 && audio && fs.existsSync(audio)) {
      onUpdate({ status: 'done', path: audio, audioPath: null, title: title || path.basename(audio) });
    } else if (code === 0 && video && fs.existsSync(video)) {
      onUpdate({ status: 'done', path: video, audioPath: audio && fs.existsSync(audio) ? audio : null, title: title || path.basename(video) });
    } else onUpdate({ status: 'error', error: lastError(stderr, code) });
  });
}

function cancelDownload(id) {
  const proc = downloads.get(id);
  if (proc) { proc.canceled = true; proc.kill(); } else canceled.add(id);
}

// ---------- streaming ----------
// YouTube serves video and audio as separate files, so each quality rung is a { video, audio } pair.
// The output window starts at 720p and steps down the ladder when the connection can't keep up.
const LADDER_HEIGHTS = [1080, 720, 480, 360, 240];
const codecRank = c => (c.startsWith('avc1') ? 0 : /^vp0?9/.test(c) ? 1 : 2);

function buildLadder(formats) {
  const direct = formats.filter(f => f.protocol === 'https' && f.url && !/drc/.test(f.format_id));
  const audios = direct
    .filter(f => f.vcodec === 'none' && f.acodec && f.acodec !== 'none' && f.ext === 'm4a')
    .sort((a, b) => (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0));
  const bestAudio = audios[0];
  const lightAudio = audios[audios.length - 1] || bestAudio;
  const ladder = [];
  if (bestAudio) {
    for (const h of LADDER_HEIGHTS) {
      const video = direct
        .filter(f => f.height === h && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'))
        .sort((a, b) => codecRank(a.vcodec) - codecRank(b.vcodec) || (a.fps || 30) - (b.fps || 30))[0];
      if (video) ladder.push({ label: h + 'p', video: proxyUrl(video), audio: proxyUrl(h <= 240 ? lightAudio : bestAudio) });
    }
  }
  // A single file with both tracks is the most robust fallback when YouTube still offers one.
  const muxed = direct
    .filter(f => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
  if (muxed) ladder.push({ label: (muxed.height || 360) + 'p·', video: proxyUrl(muxed), audio: null });
  return ladder;
}

const streamCache = new Map(); // url -> { at, info }
const STREAM_TTL = 2 * 60 * 60 * 1000; // YouTube links expire after ~6h

async function resolveStream(url, force) {
  const hit = streamCache.get(url);
  if (!force && hit && Date.now() - hit.at < STREAM_TTL) return hit.info;
  const proc = await runYtdlp([url, '-j', ...baseArgs()]);
  return new Promise((resolve, reject) => {
    let out = '', stderr = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(lastError(stderr, code)));
      try {
        const info = JSON.parse(out);
        if (info.is_live) return reject(new Error('LIVE'));
        const ladder = buildLadder(info.formats || []);
        if (!ladder.length) return reject(new Error('No playable format'));
        const result = { title: info.title, duration: info.duration || 0, ladder };
        streamCache.set(url, { at: Date.now(), info: result });
        resolve(result);
      } catch (e) { reject(e); }
    });
  });
}

async function updateYtdlp() {
  let exe;
  try { exe = await ensureYtdlp(); } catch (e) { return e.message; }
  return new Promise(resolve => {
    let out = '';
    const proc = spawn(exe, ['-U'], { windowsHide: true });
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { out += d; });
    proc.on('close', () => resolve(out.trim().split(/\r?\n/).pop() || 'Done'));
    proc.on('error', e => resolve(e.message));
  });
}

module.exports = { download, cancelDownload, resolveStream, updateYtdlp, setSetupListener, ensureFfmpeg };
