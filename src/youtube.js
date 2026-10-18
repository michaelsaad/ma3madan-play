// YouTube support through the bundled yt-dlp: downloading to disk, and resolving stream URLs.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { proxyUrl } = require('./stream-proxy');

function bundledBin(name) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', name)
    : path.join(__dirname, '..', 'bin', name);
}

// yt-dlp is copied into userData so `yt-dlp -U` can update it in place.
function ytdlpPath() {
  const target = path.join(app.getPath('userData'), 'bin', 'yt-dlp.exe');
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(bundledBin('yt-dlp.exe'), target);
  }
  return target;
}

function ffmpegPath() {
  return app.isPackaged ? bundledBin('ffmpeg.exe') : require('ffmpeg-static');
}

// YouTube needs a JavaScript runtime to solve its player challenges; Electron itself can act as Node.
const baseArgs = () => [
  '--no-playlist', '--encoding', 'utf-8',
  '--js-runtimes', 'node:' + process.execPath,
  '-S', 'res:1080,vcodec:h264,ext:mp4:m4a',
];
const env = () => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' });
const runYtdlp = args => spawn(ytdlpPath(), args, { windowsHide: true, env: env() });

function lastError(stderr, code) {
  const lines = stderr.split(/\r?\n/);
  const msg = lines.filter(l => /ERROR/.test(l)).pop() || lines.filter(Boolean).pop() || `exit ${code}`;
  return msg.replace(/^ERROR:\s*/, '');
}

// ---------- downloads ----------
const downloads = new Map(); // id -> child process

// onUpdate receives { status, title?, percent?, speed?, eta?, path?, error? }
function download(id, url, outDir, onUpdate) {
  fs.mkdirSync(outDir, { recursive: true });
  let proc;
  try {
    proc = runYtdlp([
      url, ...baseArgs(),
      '--merge-output-format', 'mp4',
      '--ffmpeg-location', ffmpegPath(),
      '-o', path.join(outDir, '%(title).120B [%(id)s].%(ext)s'),
      '--newline', '--progress', '--no-simulate',
      '--progress-template', 'download:PROG|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print', 'before_dl:TITLE|%(title)s',
      '--print', 'after_move:FILE|%(filepath)s',
    ]);
  } catch (e) {
    return onUpdate({ status: 'error', error: e.message });
  }
  downloads.set(id, proc);
  onUpdate({ status: 'starting' });

  let title = null, file = null, stderr = '', buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('TITLE|')) { title = line.slice(6).trim(); onUpdate({ title }); }
      else if (line.startsWith('FILE|')) file = line.slice(5).trim();
      else if (line.startsWith('PROG|')) {
        const [, pct, speed, eta] = line.split('|');
        const percent = parseFloat(pct);
        if (!isNaN(percent)) onUpdate({ status: 'downloading', percent, speed: speed?.trim(), eta: eta?.trim() });
      }
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', d => { stderr += d; });
  proc.on('error', e => onUpdate({ status: 'error', error: e.message }));
  proc.on('close', code => {
    downloads.delete(id);
    if (proc.canceled) onUpdate({ status: 'canceled' });
    else if (code === 0 && file && fs.existsSync(file)) onUpdate({ status: 'done', path: file, title: title || path.basename(file) });
    else onUpdate({ status: 'error', error: lastError(stderr, code) });
  });
}

function cancelDownload(id) {
  const proc = downloads.get(id);
  if (proc) { proc.canceled = true; proc.kill(); }
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

function resolveStream(url, force) {
  const hit = streamCache.get(url);
  if (!force && hit && Date.now() - hit.at < STREAM_TTL) return Promise.resolve(hit.info);
  return new Promise((resolve, reject) => {
    let out = '', stderr = '';
    const proc = runYtdlp([url, '-j', ...baseArgs()]);
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

function updateYtdlp() {
  return new Promise(resolve => {
    let out = '';
    const proc = spawn(ytdlpPath(), ['-U'], { windowsHide: true });
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { out += d; });
    proc.on('close', () => resolve(out.trim().split(/\r?\n/).pop() || 'Done'));
    proc.on('error', e => resolve(e.message));
  });
}

module.exports = { download, cancelDownload, resolveStream, updateYtdlp };
