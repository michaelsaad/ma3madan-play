// Vocal remover: splits a video's or song's audio into "music" and "vocals" tracks, once, so the
// player can mix them live (karaoke, vocals only, anything between) and save any mix as MP3.
//
// Two engines:
// - online (default, best for slow PCs): MVSEP.com's BS Roformer model, with the user's free MVSEP
//   API key. The audio is uploaded, separated on their GPUs, and the two tracks are downloaded.
// - this PC: UVR's MDX-Net model on onnxruntime (see worker.js), on the GPU when there is one.
//   The runtime (~26 MB) and the model (~67 MB) are downloaded on first use, SHA-256 pinned.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { ensureFfmpeg } = require('../youtube');

const ENGINE = {
  url: 'https://github.com/michaelsaad/ma3madan-play/releases/download/vocal-engine-1/vocal-engine-ort-1.22.0-win-x64.tar.gz',
  sha256: 'e150b6765de2c1cb486283d09b771c4d1100c213653a9d0570fff50616f9b19a',
  dir: 'vocal-engine-1',
};
const MODEL = {
  url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx',
  sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc',
  file: 'UVR-MDX-NET-Inst_HQ_3.onnx',
};
const MVSEP = 'https://mvsep.com/api';
// BS Roformer (vocals + instrumental), default variant, m4a output. Free for registered users.
const MVSEP_JOB = { sep_type: '40', add_opt1: '81', add_opt2: '2', output_format: '3' };

const dataDir = () => path.join(app.getPath('userData'), 'vocals');
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

let onSetup = () => {};

async function download(url, tool) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let got = 0, last = -1;
  for await (const c of res.body) {
    chunks.push(c);
    got += c.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct !== last && pct < 100) { last = pct; onSetup(tool, pct / 100); }
  }
  return Buffer.concat(chunks);
}

// Minimal reader for the engine's .tar.gz (regular files and folders only).
function untar(buf, dest) {
  for (let off = 0; off + 512 <= buf.length;) {
    const header = buf.subarray(off, off + 512);
    if (header.every(b => b === 0)) break;
    const field = (s, n) => header.subarray(s, s + n).toString('utf8').replace(/\0.*$/s, '');
    const name = (field(345, 155) ? field(345, 155) + '/' : '') + field(0, 100);
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const target = path.join(dest, name);
    const rel = path.relative(dest, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Bad path in engine archive');
    if (type === '5') fs.mkdirSync(target, { recursive: true });
    else if (rel && (type === '0' || type === '\0')) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buf.subarray(off + 512, off + 512 + size));
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
}

const pending = new Map();
function once(key, fn) {
  if (!pending.has(key)) pending.set(key, fn().finally(() => pending.delete(key)));
  return pending.get(key);
}

const ensureEngine = () => once('engine', async () => {
  const dir = path.join(dataDir(), ENGINE.dir);
  if (fs.existsSync(path.join(dir, '.ok'))) return dir;
  onSetup('engine', 0);
  const gz = await download(ENGINE.url, 'engine');
  if (sha256(gz) !== ENGINE.sha256) throw new Error('The vocal remover engine failed its checksum check');
  fs.rmSync(dir, { recursive: true, force: true });
  untar(zlib.gunzipSync(gz), dir);
  fs.writeFileSync(path.join(dir, '.ok'), '');
  onSetup('engine', 1);
  return dir;
});

const ensureModel = () => once('model', async () => {
  const file = path.join(dataDir(), MODEL.file);
  if (fs.existsSync(file)) return file;
  onSetup('model', 0);
  const data = await download(MODEL.url, 'model');
  if (sha256(data) !== MODEL.sha256) throw new Error('The vocal remover model failed its checksum check');
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(file + '.part', data);
  fs.renameSync(file + '.part', file);
  onSetup('model', 1);
  return file;
});

// ---------- jobs (one at a time: the GPU, or MVSEP's free tier, does one well) ----------
const jobs = new Map();   // id -> { cancel }
let queue = Promise.resolve();

function stemPaths(outDir, title) {
  const safe = (title || 'track').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 100).trim() || 'track';
  const dir = path.join(outDir, 'Separated');
  fs.mkdirSync(dir, { recursive: true });
  return { music: path.join(dir, `${safe} - music.m4a`), vocals: path.join(dir, `${safe} - vocals.m4a`) };
}

function runLocal(job, emit, settings, saveSetting) {
  return (async () => {
    const [ffmpeg, engineDir, model] = await Promise.all([ensureFfmpeg(), ensureEngine(), ensureModel()]);
    if (job.canceled) throw new Error('canceled');
    emit({ stage: 'processing', progress: 0 });
    await new Promise((resolve, reject) => {
      // In the installed app the worker is unpacked next to app.asar (see "asarUnpack" in package.json).
      const worker = path.join(__dirname, 'worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
      const proc = spawn(process.execPath, [worker], {
        windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      job.cancel = () => proc.kill();
      let buf = '', error = null;
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', d => {
        buf += d;
        for (let nl; (nl = buf.indexOf('\n')) >= 0;) {
          const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
          if (msg.type === 'device' && settings.vocalDevice == null) saveSetting('vocalDevice', msg.device);
          if (msg.type === 'progress') emit({ stage: 'processing', progress: msg.progress });
          if (msg.type === 'error') error = msg.error;
        }
      });
      proc.on('close', code => (job.canceled ? reject(new Error('canceled')) : code === 0 ? resolve() : reject(new Error(error || `exit ${code}`))));
      proc.stdin.end(JSON.stringify({ engineDir, model, ffmpeg, input: job.input, music: job.music, vocals: job.vocals, device: settings.vocalDevice ?? 'auto' }) + '\n');
    });
  })();
}

async function runOnline(job, emit, token) {
  if (!token) throw new Error('NO_TOKEN');
  // Upload just the sound. A separate .m4a (YouTube downloads) or an audio file goes as is;
  // a video's sound is copied out first so the upload stays small.
  let upload = job.input, temp = null;
  if (!/\.(m4a|mp3|wav|flac|ogg|opus|aac)$/i.test(upload)) {
    const ffmpeg = await ensureFfmpeg();
    temp = path.join(os.tmpdir(), `ma3madan-${job.id}.m4a`);
    await new Promise((ok, fail) => {
      const p = spawn(ffmpeg, ['-v', 'error', '-y', '-i', upload, '-vn', '-c:a', 'aac', '-b:a', '256k', temp], { windowsHide: true });
      p.on('close', c => (c === 0 ? ok() : fail(new Error('Could not read the sound of this video'))));
    });
    upload = temp;
  }
  try {
    emit({ stage: 'uploading', progress: 0 });
    const form = new FormData();
    form.append('api_token', token);
    for (const [k, v] of Object.entries(MVSEP_JOB)) form.append(k, v);
    form.append('audiofile', await fs.openAsBlob(upload), path.basename(upload));
    const created = await fetch(`${MVSEP}/separation/create`, { method: 'POST', body: form }).then(r => r.json());
    if (!created.success) throw new Error(created.data?.message || created.errors?.[0] || 'MVSEP refused the job');
    const hash = created.data.hash;
    job.cancel = () => {
      const f = new FormData(); f.append('api_token', token); f.append('hash', hash);
      fetch(`${MVSEP}/separation/cancel`, { method: 'POST', body: f }).catch(() => {});
    };

    for (;;) {
      if (job.canceled) throw new Error('canceled');
      await new Promise(ok => setTimeout(ok, 4000));
      const r = await fetch(`${MVSEP}/separation/get?hash=${encodeURIComponent(hash)}`).then(x => x.json());
      const d = r.data || {};
      if (r.status === 'failed') throw new Error(d.message || 'MVSEP could not separate this file');
      if (r.status === 'waiting') emit({ stage: 'queued', position: d.current_order, queue: d.queue_count });
      else if (r.status === 'distributing' && d.all_chunks) emit({ stage: 'processing', progress: d.finished_chunks / d.all_chunks });
      else if (r.status === 'processing' || r.status === 'merging') emit({ stage: 'processing', progress: null });
      else if (r.status === 'done') {
        const files = (d.files || []).map(f => ({ url: f.url || f.link || f.download, label: `${f.type || ''} ${f.name || ''} ${f.download || ''} ${f.url || ''}` }));
        const vocals = files.find(f => /vocal/i.test(f.label) && !/instrum/i.test(f.label));
        const music = files.find(f => /instrum|music|other/i.test(f.label));
        if (!vocals?.url || !music?.url) throw new Error('MVSEP returned unexpected files');
        emit({ stage: 'downloading', progress: 0 });
        for (const [i, [f, dest]] of [[music, job.music], [vocals, job.vocals]].entries()) {
          const res = await fetch(f.url);
          if (!res.ok) throw new Error(`Download failed (${res.status})`);
          fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
          emit({ stage: 'downloading', progress: (i + 1) / 2 });
        }
        const del = new FormData(); del.append('api_token', token); del.append('hash', hash);
        fetch(`${MVSEP}/separation/delete`, { method: 'POST', body: del }).catch(() => {}); // don't leave the song on their server
        return;
      }
    }
  } finally {
    if (temp) fs.rm(temp, { force: true }, () => {});
  }
}

// emit(event) gets { stage: 'setup'|'queued'|'uploading'|'processing'|'downloading'|'done'|'error', ... }
function start({ id, input, title, engine, outDir }, emit, settings, saveSetting) {
  const job = { id, input, ...stemPaths(outDir, title), canceled: false, cancel: () => {} };
  jobs.set(id, job);
  emit({ stage: 'waiting' });
  queue = queue.then(async () => {
    if (job.canceled) return emit({ stage: 'canceled' });
    try {
      if (engine === 'online') await runOnline(job, emit, settings.mvsepToken);
      else await runLocal(job, emit, settings, saveSetting);
      emit({ stage: 'done', music: job.music, vocals: job.vocals });
    } catch (e) {
      for (const f of [job.music, job.vocals]) fs.rm(f, { force: true }, () => {});
      emit(job.canceled || e.message === 'canceled' ? { stage: 'canceled' } : { stage: 'error', error: e.message });
    } finally {
      jobs.delete(id);
    }
  });
}

function cancel(id) {
  const job = jobs.get(id);
  if (job) { job.canceled = true; job.cancel(); }
}

// Mix the two tracks at the given levels (0–2) into an MP3.
async function saveMix({ music, vocals, gains, dest }) {
  const ffmpeg = await ensureFfmpeg();
  const vm = Math.max(0, gains.music ?? 1), vv = Math.max(0, gains.vocals ?? 1);
  await new Promise((ok, fail) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-y', '-i', music, '-i', vocals, '-filter_complex',
      `[0:a]volume=${vm}[m];[1:a]volume=${vv}[v];[m][v]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.98[out]`,
      '-map', '[out]', '-c:a', 'libmp3lame', '-b:a', '256k', dest], { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', c => (c === 0 ? ok() : fail(new Error(err.trim().split('\n').pop() || `exit ${c}`))));
  });
  return dest;
}

function setSetupListener(fn) { onSetup = fn; }

module.exports = { start, cancel, saveMix, setSetupListener };
