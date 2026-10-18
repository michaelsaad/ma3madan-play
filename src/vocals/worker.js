// Vocal separation on this PC. Runs as its own process (Electron in Node mode) so the UI stays smooth.
//
// Model: UVR's MDX-Net "Inst HQ 3" (ONNX) on onnxruntime, on the GPU through DirectML when one is
// available. Pipeline as in UVR: STFT (n_fft 6144, hop 1024, Hann, centred) → model → inverse STFT,
// in chunks of 256 frames with n_fft/2 trimmed at both ends. The model gives the music; the vocals
// are the original minus the music, so music + vocals at 100% is exactly the original.
//
// Audio is streamed: FFmpeg decodes the input to 44.1 kHz stereo float, and two more FFmpeg
// processes encode the music and vocals tracks as they're produced.
//
// stdin: one JSON line { engineDir, model, ffmpeg, input, music, vocals, device } (device: number or 'auto')
// stdout: JSON lines { type: 'device'|'progress'|'done'|'error', ... }
const { spawn } = require('child_process');
const path = require('path');

const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');

const N_FFT = 6144, HOP = 1024, DIM_F = 3072, DIM_T = 256, COMPENSATE = 1.022, RATE = 44100;
const CHUNK = HOP * (DIM_T - 1);   // samples per model call
const TRIM = N_FFT / 2;
const GEN = CHUNK - 2 * TRIM;     // new samples produced per call

// ---------- FFT for N = 6144 = 3 × 2048 ----------
const M = 2048, LOG_M = 11;
const rev = new Uint16Array(M);
for (let i = 0; i < M; i++) { let r = 0; for (let b = 0; b < LOG_M; b++) r |= ((i >> b) & 1) << (LOG_M - 1 - b); rev[i] = r; }
const twRe = new Float64Array(M / 2), twIm = new Float64Array(M / 2);
for (let i = 0; i < M / 2; i++) { twRe[i] = Math.cos(-2 * Math.PI * i / M); twIm[i] = Math.sin(-2 * Math.PI * i / M); }
function fft2048(re, im) {
  for (let i = 0; i < M; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= M; size <<= 1) {
    const half = size >> 1, step = M / size;
    for (let s = 0; s < M; s += size) {
      for (let k = 0; k < half; k++) {
        const wr = twRe[k * step], wi = twIm[k * step];
        const a = s + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
    }
  }
}
const WN_re = new Float64Array(N_FFT), WN_im = new Float64Array(N_FFT);
for (let k = 0; k < N_FFT; k++) { WN_re[k] = Math.cos(-2 * Math.PI * k / N_FFT); WN_im[k] = Math.sin(-2 * Math.PI * k / N_FFT); }
const sub = [0, 1, 2].map(() => ({ re: new Float64Array(M), im: new Float64Array(M) }));
function fft6144(inRe, inIm, outRe, outIm, inverse) {
  for (let r = 0; r < 3; r++) {
    const s = sub[r];
    for (let n = 0; n < M; n++) { s.re[n] = inRe[3 * n + r]; s.im[n] = inverse ? -inIm[3 * n + r] : inIm[3 * n + r]; }
    fft2048(s.re, s.im);
  }
  for (let k = 0; k < N_FFT; k++) {
    const km = k & (M - 1);
    let re = sub[0].re[km], im = sub[0].im[km];
    for (let r = 1; r < 3; r++) {
      const idx = (r * k) % N_FFT, wr = WN_re[idx], wi = WN_im[idx];
      const sr = sub[r].re[km], si = sub[r].im[km];
      re += sr * wr - si * wi; im += sr * wi + si * wr;
    }
    outRe[k] = re; outIm[k] = inverse ? -im : im;
  }
}
const win = new Float64Array(N_FFT);
for (let n = 0; n < N_FFT; n++) win[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / N_FFT);

const fr = new Float64Array(N_FFT), fi = new Float64Array(N_FFT), Xr = new Float64Array(N_FFT), Xi = new Float64Array(N_FFT);
const padded = new Float64Array(CHUNK + N_FFT);
function stftInto(signal, tensor, plane) {
  for (let i = 0; i < padded.length; i++) {
    let j = i - TRIM; // reflect padding, like torch.stft(center=True)
    if (j < 0) j = -j; else if (j >= CHUNK) j = 2 * (CHUNK - 1) - j;
    padded[i] = signal[j];
  }
  for (let t = 0; t < DIM_T; t++) {
    const off = t * HOP;
    for (let n = 0; n < N_FFT; n++) { fr[n] = padded[off + n] * win[n]; fi[n] = 0; }
    fft6144(fr, fi, Xr, Xi, false);
    for (let f = 0; f < DIM_F; f++) {
      tensor[(plane * DIM_F + f) * DIM_T + t] = Xr[f];
      tensor[((plane + 1) * DIM_F + f) * DIM_T + t] = Xi[f];
    }
  }
}
const ola = new Float64Array(CHUNK + N_FFT), env = new Float64Array(CHUNK + N_FFT);
function istftFrom(tensor, plane, out) {
  ola.fill(0); env.fill(0);
  for (let t = 0; t < DIM_T; t++) {
    fr.fill(0); fi.fill(0);
    for (let f = 0; f < DIM_F; f++) {
      const re = tensor[(plane * DIM_F + f) * DIM_T + t], im = tensor[((plane + 1) * DIM_F + f) * DIM_T + t];
      fr[f] = re; fi[f] = im;
      if (f > 0) { fr[N_FFT - f] = re; fi[N_FFT - f] = -im; }
    }
    fft6144(fr, fi, Xr, Xi, true);
    const off = t * HOP;
    for (let n = 0; n < N_FFT; n++) { ola[off + n] += (Xr[n] / N_FFT) * win[n]; env[off + n] += win[n] * win[n]; }
  }
  for (let i = 0; i < CHUNK; i++) { const e = env[i + TRIM]; out[i] = e > 1e-8 ? ola[i + TRIM] / e : 0; }
}

// ---------- GPU choice ----------
// DirectML picks adapter 0 by default, which on laptops is often the slow integrated GPU, and its
// "high performance" preference isn't honoured. So time one call on each adapter (and the CPU) and keep the fastest.
async function openSession(ort, model, device) {
  const opts = id => ({ executionProviders: id === 'cpu' ? ['cpu'] : [{ name: 'dml', deviceId: id }], graphOptimizationLevel: 'all' });
  if (device !== 'auto') return { session: await ort.InferenceSession.create(model, opts(device)), device };
  const probe = new ort.Tensor('float32', new Float32Array(4 * DIM_F * DIM_T), [1, 4, DIM_F, DIM_T]);
  let best = null;
  for (const id of [0, 1, 2, 3, 'cpu']) {
    let session;
    try {
      session = await ort.InferenceSession.create(model, opts(id));
      await session.run({ input: probe }); // warm-up
      const t = Date.now();
      await session.run({ input: probe });
      const ms = Date.now() - t;
      if (!best || ms < best.ms) { await best?.session.release(); best = { session, device: id, ms }; } else await session.release();
    } catch { await session?.release?.(); if (typeof id === 'number' && id > 0) continue; }
    if (best && best.ms < 600) break; // a proper GPU: no need to try the rest
  }
  if (!best) throw new Error('No device could run the model');
  return best;
}

// ---------- main ----------
async function run(job) {
  const ort = require(path.join(job.engineDir, 'node_modules', 'onnxruntime-node'));
  const { session, device, ms } = await openSession(ort, job.model, job.device);
  send({ type: 'device', device, ms });

  const dec = spawn(job.ffmpeg, ['-v', 'error', '-i', job.input, '-vn', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { windowsHide: true });
  const enc = file => spawn(job.ffmpeg, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', '-', '-c:a', 'aac', '-b:a', '192k', file], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
  const musicOut = enc(job.music), vocalsOut = enc(job.vocals);
  const write = (proc, buf) => new Promise(ok => (proc.stdin.write(buf) ? ok() : proc.stdin.once('drain', ok)));

  // Rolling, zero-padded input (TRIM zeros in front, as in UVR).
  let L = new Float32Array(1 << 22), R = new Float32Array(1 << 22);
  let have = TRIM, base = 0, ended = false, pending = Buffer.alloc(0);
  const ensure = need => { if (need <= L.length) return; let n = L.length; while (n < need) n *= 2; const nl = new Float32Array(n), nr = new Float32Array(n); nl.set(L); nr.set(R); L = nl; R = nr; };
  let waiting = null;
  dec.stdout.on('data', chunk => {
    pending = Buffer.concat([pending, chunk]);
    const frames = Math.floor(pending.length / 8);
    if (!frames) return;
    const f32 = new Float32Array(pending.buffer.slice(pending.byteOffset, pending.byteOffset + frames * 8));
    pending = pending.subarray(frames * 8);
    ensure(have - base + frames);
    for (let i = 0; i < frames; i++) { L[have - base + i] = f32[2 * i]; R[have - base + i] = f32[2 * i + 1]; }
    have += frames;
    if (have - base >= 2 * CHUNK) dec.stdout.pause(); // enough buffered; resumed after each chunk
    if (waiting && have - base >= CHUNK) { const w = waiting; waiting = null; w(); }
  });
  dec.stdout.on('end', () => { ended = true; if (waiting) { const w = waiting; waiting = null; w(); } });
  let decErr = '';
  dec.stderr.on('data', d => { decErr += d; });

  // Total length for progress, from ffprobe-style "Duration:" isn't printed at -v error, so ask once.
  const total = await new Promise(ok => {
    const p = spawn(job.ffmpeg, ['-i', job.input], { windowsHide: true });
    let s = '';
    p.stderr.on('data', d => { s += d; });
    p.on('close', () => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(s); ok(m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) * RATE : 0); });
  });

  const tensor = new Float32Array(4 * DIM_F * DIM_T);
  const outL = new Float64Array(CHUNK), outR = new Float64Array(CHUNK);
  let produced = 0, lastPct = -1;
  for (;;) {
    if (have - base < CHUNK && !ended) { await new Promise(ok => { waiting = ok; dec.stdout.resume(); }); continue; }
    const realLeft = have - base - TRIM; // real samples not yet produced (excluding the leading pad)
    if (realLeft <= 0 && ended) break;
    // Zero-fill the tail past the end of the input.
    ensure(base + CHUNK - base);
    for (let i = have - base; i < CHUNK; i++) { L[i] = 0; R[i] = 0; }
    stftInto(L.subarray(0, CHUNK), tensor, 0);
    stftInto(R.subarray(0, CHUNK), tensor, 2);
    const res = await session.run({ input: new ort.Tensor('float32', tensor, [1, 4, DIM_F, DIM_T]) });
    istftFrom(res.output.data, 0, outL);
    istftFrom(res.output.data, 2, outR);

    const count = Math.min(GEN, Math.max(0, realLeft));
    const music = new Float32Array(count * 2), vocals = new Float32Array(count * 2);
    for (let j = 0; j < count; j++) {
      const ml = outL[TRIM + j] * COMPENSATE, mr = outR[TRIM + j] * COMPENSATE;
      const ol = L[TRIM + j], or = R[TRIM + j];
      music[2 * j] = ml; music[2 * j + 1] = mr;
      vocals[2 * j] = ol - ml; vocals[2 * j + 1] = or - mr;
    }
    await write(musicOut, Buffer.from(music.buffer));
    await write(vocalsOut, Buffer.from(vocals.buffer));
    produced += count;

    // Slide the window forward by GEN samples.
    const keep = have - base - GEN;
    L.copyWithin(0, GEN, GEN + Math.max(keep, 0)); R.copyWithin(0, GEN, GEN + Math.max(keep, 0));
    base += GEN;
    if (!ended) dec.stdout.resume();

    const pct = total ? Math.min(99, Math.floor((produced / total) * 100)) : 0;
    if (pct !== lastPct) { lastPct = pct; send({ type: 'progress', progress: pct / 100 }); }
    if (ended && have - base - TRIM <= 0) break;
  }
  await session.release();
  const finish = proc => new Promise(ok => { proc.on('close', ok); proc.stdin.end(); });
  await Promise.all([finish(musicOut), finish(vocalsOut)]);
  if (!produced) throw new Error(decErr.trim().split('\n').pop() || 'No audio found in this file');
  send({ type: 'done' });
}

let input = '';
process.stdin.on('data', d => {
  input += d;
  const nl = input.indexOf('\n');
  if (nl < 0) return;
  run(JSON.parse(input.slice(0, nl)))
    .then(() => process.exit(0))
    .catch(e => { send({ type: 'error', error: e.message }); process.exit(1); });
});
