const $ = id => document.getElementById(id);

let items = [];            // { id, title, path, source: 'file'|'youtube', url?, duration?, missing? }
let selectedId = null;
let playingId = null;
let out = { loaded: false, paused: true, time: 0, duration: 0, volume: 1, muted: false, black: true };
let seeking = false;
let settings = {};
let displays = null;
const downloads = new Map(); // id -> { url, title, status, percent, speed, eta, error }

const MAX_VOLUME = 2;      // 200%, like VLC
const ASPECTS = ['default', '16:9', '4:3', '16:10', '1:1', '5:4', '2.21:1', '2.35:1', '2.39:1', 'fill', 'crop'];
let aspect = 'default';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cmd = (type, data = {}) => api.sendCmd({ type, ...data });

function fmt(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
function baseName(p) { return p.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function aspectLabel(a) {
  return a === 'default' ? t('aspectDefault') : a === 'fill' ? t('aspectFill') : a === 'crop' ? t('aspectCrop') : a;
}

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---------- language ----------
function setLang(lang) {
  applyLang(lang);
  settings.lang = LANG; api.setSetting('lang', LANG);
  $('langBtn').querySelector('span').textContent = t('otherLang');
  $('aspectSel').innerHTML = ASPECTS.map(a => `<option value="${a}">${escapeHtml(aspectLabel(a))}</option>`).join('');
  $('aspectSel').value = aspect;
  renderDisplays(); loadSinks(); renderList(); renderState(); renderDownloads(); renderUpdate();
}
$('langBtn').onclick = () => setLang(LANG === 'en' ? 'ar' : 'en');

// ---------- window buttons (the window has no system title bar) ----------
$('winMin').onclick = () => api.winAction('minimize');
$('winMax').onclick = () => api.winAction('maximize');
$('winClose').onclick = () => api.winAction('close');
function renderMaximized(max) {
  setIcon($('winMax'), max ? 'i-win-restore' : 'i-win-max');
  $('winMax').title = t(max ? 'tRestore' : 'tMaximize');
}
api.onWinMaximized(renderMaximized);

// ---------- app update (optional: only when the operator clicks) ----------
let update = null;      // { version, notes, canInstall }
let updating = false;
function renderUpdate(progress) {
  const b = $('updateBtn');
  b.hidden = !update;
  if (!update) return;
  b.disabled = updating;
  b.querySelector('span').textContent = updating
    ? (progress >= 1 ? t('updateInstalling') : t('updateDownloading', { n: Math.round((progress || 0) * 100) }))
    : t(update.canInstall ? 'updateTo' : 'updateGet', { v: update.version });
  b.title = t(update.canInstall ? 'updateTip' : 'updatePortableTip') + (update.notes ? '\n\n' + update.notes.slice(0, 400) : '');
}
api.onUpdateAvailable(info => { update = info; renderUpdate(); });
api.onUpdateProgress(p => renderUpdate(p));
$('updateBtn').onclick = async () => {
  if (!update || updating) return;
  updating = update.canInstall;
  renderUpdate(0);
  const r = await api.installUpdate();
  if (!r.ok) toast(t('updateFailed', { e: r.error }));
  if (r.result === 'verified') toast('Update verified (dry run)');
  updating = false;
  renderUpdate();
};

// ---------- playlist ----------
const save = () => api.savePlaylist(items);

function addPaths(paths) {
  const existing = new Set(items.map(i => i.path.toLowerCase()));
  let added = 0;
  for (const p of paths) {
    if (existing.has(p.toLowerCase())) continue;
    items.push({ id: uid(), title: baseName(p), path: p, source: 'file' });
    added++;
  }
  if (added) { save(); renderList(); probeDurations(); toast(t('added', { n: added })); }
}

function renderList() {
  const ol = $('playlist');
  ol.innerHTML = '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'item' + (it.id === selectedId ? ' selected' : '') + (it.id === playingId ? ' playing' : '') + (it.missing ? ' missing' : '');
    li.draggable = true;
    li.dataset.id = it.id;
    const idx = it.id === playingId ? '<svg><use href="#i-play"/></svg>' : (i + 1);
    const kind = it.source === 'stream' ? t('streamOnline') : it.source === 'youtube' ? t('youtube') : '';
    const sub = it.loading ? t('loading') : it.missing ? t('fileMissing')
      : [kind, isAudio(it) ? t('audioLabel') : ''].filter(Boolean).join(' · ');
    li.innerHTML = `
      <span class="item-idx">${idx}</span>
      <span style="min-width:0"><div class="item-title" dir="auto" title="${escapeHtml(it.path)}">${escapeHtml(it.title)}</div>${sub ? `<div class="item-sub">${sub}</div>` : ''}</span>
      <span class="item-dur" dir="ltr">${it.duration ? fmt(it.duration) : ''}</span>
      <button class="item-more" title="${escapeHtml(t('more'))}"><svg><use href="#i-more"/></svg></button>`;
    li.addEventListener('click', e => {
      selectedId = it.id; renderList();
      const more = e.target.closest('.item-more');
      if (more) { const r = more.getBoundingClientRect(); showItemMenu(it, r.left, r.bottom + 4); }
    });
    li.addEventListener('dblclick', e => { if (!e.target.closest('.item-more')) playItem(it); });
    li.addEventListener('contextmenu', e => {
      e.preventDefault();
      selectedId = it.id; renderList();
      showItemMenu(it, e.clientX, e.clientY);
    });

    li.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-item', it.id); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('text/x-item')) return;
      e.preventDefault(); li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', e => {
      const from = e.dataTransfer.getData('text/x-item');
      li.classList.remove('drag-over');
      if (!from || from === it.id) return;
      e.preventDefault(); e.stopPropagation();
      const moving = items.find(x => x.id === from);
      items = items.filter(x => x.id !== from);
      items.splice(items.findIndex(x => x.id === it.id), 0, moving);
      save(); renderList();
    });
    ol.appendChild(li);
  });
  $('emptyList').style.display = items.length ? 'none' : 'block';
  $('listCount').textContent = items.length ? (items.length === 1 ? t('videoOne') : t('videosCount', { n: items.length })) : '';
  renderNow();
}

const AUDIO_RE = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|weba)$/i;
const isAudio = it => it.source !== 'stream' && AUDIO_RE.test(it.path);

// ---------- pop-up menu (playlist items, Download button) ----------
// entries: [{ label, icon?, action, danger? }] with '-' for a divider.
function showMenu(x, y, entries) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.id = 'menu';
  for (const e of entries) {
    if (e === '-') { menu.appendChild(Object.assign(document.createElement('hr'), {})); continue; }
    const b = document.createElement('button');
    b.className = e.danger ? 'danger' : '';
    b.innerHTML = `${e.icon ? `<svg><use href="#${e.icon}"/></svg>` : '<i></i>'}<span>${escapeHtml(e.label)}</span>`;
    b.onclick = () => { closeMenu(); e.action(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  menu.querySelector('button')?.focus();
}
function closeMenu() { document.getElementById('menu')?.remove(); }
document.addEventListener('mousedown', e => { if (!e.target.closest('#menu')) closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

function showItemMenu(it, x, y) {
  const entries = [{ label: t('menuPlay'), icon: 'i-play', action: () => playItem(it) }, '-'];
  if (it.source === 'stream') {
    entries.push(
      { label: t('menuDownloadVideo'), icon: 'i-download', action: () => startDownload(it.url, 'video', { replaceId: it.id, title: it.title }) },
      { label: t('menuDownloadMp3'), icon: 'i-music', action: () => startDownload(it.url, 'mp3', { afterId: it.id, title: it.title }) },
      { label: t('menuOpenLink'), icon: 'i-yt', action: () => api.openExternal(it.url) });
  } else {
    entries.push({ label: t('menuShowFile'), icon: 'i-folder', action: () => api.showInFolder(it.path) });
    if (it.url) {
      if (!isAudio(it)) entries.push({ label: t('menuDownloadMp3'), icon: 'i-music', action: () => startDownload(it.url, 'mp3', { afterId: it.id, title: it.title }) });
      entries.push({ label: t('menuOpenLink'), icon: 'i-yt', action: () => api.openExternal(it.url) });
    }
  }
  entries.push('-', { label: t('removeFromList'), icon: 'i-x', danger: true, action: () => removeItem(it.id) });
  showMenu(x, y, entries);
}

function removeItem(id) {
  items = items.filter(x => x.id !== id);
  if (selectedId === id) selectedId = null;
  save(); renderList();
}

// Read durations one at a time with a hidden <video>.
let probing = false;
async function probeDurations() {
  if (probing) return;
  probing = true;
  const probe = $('probe');
  for (const it of items) {
    if (it.duration || it.missing || it.source === 'stream') continue;
    probe.src = await api.fileUrl(it.path);
    const d = await new Promise(res => {
      const done = v => { probe.onloadedmetadata = probe.onerror = null; res(v); };
      probe.onloadedmetadata = () => done(probe.duration);
      probe.onerror = () => done(0);
      setTimeout(() => done(0), 8000);
    });
    if (d && isFinite(d)) { it.duration = d; renderList(); }
  }
  probe.removeAttribute('src'); probe.load();
  probing = false;
  save();
}

// ---------- playback ----------
let streamRetried = null;  // item id already re-resolved after a playback error
async function playItem(it, { autoplay = true, force = false, startAt = 0 } = {}) {
  if (!it) return;
  if (it.missing) { toast(t('fileMissing')); return; }
  if (it.loading) return;
  playingId = it.id; selectedId = it.id;
  if (!force) streamRetried = null;
  let src;
  if (it.source === 'stream') {
    it.loading = true; renderList();
    const r = await api.resolveStream(it.url, force);
    it.loading = false;
    if (!r.ok) { renderList(); toast(r.error === 'LIVE' ? t('liveNotSupported') : t('streamFailed', { e: r.error })); return; }
    if (it.title !== r.title || it.duration !== r.duration) { it.title = r.title; it.duration = r.duration; save(); }
    if (playingId !== it.id) return; // something else was started meanwhile
    src = { path: it.path, ladder: r.ladder, quality: settings.streamQuality || 'auto' };
  } else {
    src = { path: it.path, url: await api.fileUrl(it.path), audioUrl: it.audioPath ? await api.fileUrl(it.audioPath) : null };
  }
  cmd('load', { ...src, audio: isAudio(it), autoplay, startAt, volume: settings.volume ?? 1, muted: !!settings.muted });
  cmd('rate', { r: parseFloat($('rateSel').value) });
  cmd('loop', { on: $('loopChk').checked });
  renderList();
}

function indexOfPlaying() { return items.findIndex(x => x.id === playingId); }
function nextItem() {
  const i = indexOfPlaying();
  const n = items.slice(i + 1).find(x => !x.missing);
  if (n) playItem(n); else toast(t('lastVideo'));
}
function prevItem() {
  const i = indexOfPlaying();
  if (out.time > 3 && i >= 0) { cmd('seek', { t: 0 }); return; }
  const p = items.slice(0, Math.max(i, 0)).reverse().find(x => !x.missing);
  if (p) playItem(p); else cmd('seek', { t: 0 });
}
function togglePlay() {
  if (!out.loaded) {
    const it = items.find(x => x.id === selectedId) || items.find(x => !x.missing);
    if (it) playItem(it); else toast(t('addFirst'));
    return;
  }
  cmd('toggle');
}
function setVolume(v) {
  v = Math.max(0, Math.min(MAX_VOLUME, Math.round(v * 100) / 100));
  settings.volume = v; api.setSetting('volume', v);
  if (v > 0 && settings.muted) { settings.muted = false; api.setSetting('muted', false); }
  cmd('volume', { v });
  renderVolume(v, settings.muted);
  return v;
}
function toggleMute() {
  settings.muted = !out.muted; api.setSetting('muted', settings.muted);
  cmd('mute', { m: settings.muted });
}
function setAspect(a, announce) {
  aspect = a;
  $('aspectSel').value = a;
  cmd('aspect', { mode: a });
  if (announce) toast(t('aspectToast', { a: aspectLabel(a) }));
}

// Swap a button's icon in place. Rebuilding the button's contents on every state update (4× a second
// while playing) dropped clicks that landed mid-swap.
function setIcon(btn, id) {
  const use = btn.querySelector('use');
  if (use.getAttribute('href') !== '#' + id) use.setAttribute('href', '#' + id);
}

// Range inputs draw their filled part from --p (0–100).
function setFill(input) {
  input.style.setProperty('--p', ((input.value - input.min) / (input.max - input.min)) * 100 + '%');
}

function renderVolume(v, muted) {
  const vol = $('vol');
  if (document.activeElement !== vol) vol.value = Math.round(v * 100);
  setFill(vol);
  vol.classList.toggle('boost', v > 1);
  $('volPct').textContent = muted ? t('muted') : Math.round(v * 100) + '%';
  $('volPct').classList.toggle('boost', !muted && v > 1);
  setIcon($('muteBtn'), muted || v === 0 ? 'i-mute' : 'i-vol');
}

function renderNow() {
  const it = items.find(x => x.id === playingId);
  $('nowTitle').textContent = out.loaded && it ? it.title : t('nothingPlaying');
  const i = indexOfPlaying();
  const n = i >= 0 ? items.slice(i + 1).find(x => !x.missing) : null;
  $('nextTitle').textContent = (out.buffering || it?.loading) ? t('loading') : (n ? t('next') + n.title : '');
}

function renderState() {
  setIcon($('playBtn'), out.paused ? 'i-play' : 'i-pause');
  if (!seeking) {
    $('seek').value = out.duration ? Math.round((out.time / out.duration) * 1000) : 0;
    $('tCur').textContent = fmt(out.time);
  }
  setFill($('seek'));
  $('tDur').textContent = fmt(out.duration);
  renderVolume(out.volume, out.muted);
  renderQuality();
  $('blackBtn').classList.toggle('on', out.black);

  document.querySelector('.preview').classList.toggle('live', out.loaded && !out.paused && (out.audioOnly || !out.black));
  $('audioBadge').hidden = !(out.loaded && out.audioOnly);
  renderNow();
}

// Stream quality picker; only shown while a YouTube stream is on screen.
let qualityKey = '';
function renderQuality() {
  const field = $('qualityField'), sel = $('qualitySel');
  field.style.display = out.loaded && out.qualities ? '' : 'none';
  if (!out.qualities) return;
  const key = [LANG, out.autoQuality, out.quality, ...out.qualities].join('|');
  if (key === qualityKey || document.activeElement === sel) return;
  qualityKey = key;
  sel.innerHTML = `<option value="auto">${escapeHtml(t('qualityAuto'))}${out.autoQuality ? ' (' + out.quality + ')' : ''}</option>`
    + out.qualities.map(q => `<option value="${q}">${q}</option>`).join('');
  sel.value = out.autoQuality ? 'auto' : out.quality;
}
$('qualitySel').addEventListener('change', e => {
  settings.streamQuality = e.target.value; api.setSetting('streamQuality', e.target.value);
  cmd('quality', { q: e.target.value });
  e.target.blur();
});

api.onState(s => {
  if (s.qualityChanged === 'auto') toast(t('qualityLowered', { q: s.quality }));
  const wasEnded = out.ended;
  const hadError = out.error;
  out = s;
  if (s.error && !hadError) {
    // Stream links expire; fetch a fresh one once and continue from the same spot.
    const it = items.find(x => x.id === playingId);
    if (it?.source === 'stream' && streamRetried !== it.id) { streamRetried = it.id; playItem(it, { force: true, startAt: s.time }); }
    else toast(t('playError'));
  }
  renderState();
  if (s.ended && !wasEnded && !s.loop && $('autoNext').checked) nextItem();
});

// ---------- preview: live capture of the output window ----------
let previewStream = null;
async function startPreview() {
  try {
    const id = await api.outputSourceId();
    if (!id) throw new Error('no output');
    previewStream?.getTracks().forEach(tr => tr.stop());
    previewStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 1280, maxHeight: 720, maxFrameRate: 30 } },
    });
    $('preview').srcObject = previewStream;
    previewStream.getVideoTracks()[0].onended = () => setTimeout(startPreview, 1000);
  } catch (e) {
    console.warn('preview failed', e);
    setTimeout(startPreview, 2000);
  }
}
let outputReady = false;
let playWhenReady = null;
api.onOutputReady(() => {
  outputReady = true;
  startPreview(); applyOutputSettings();
  if (playWhenReady) { playItem(playWhenReady); playWhenReady = null; }
});

// Files opened from Explorer: add them and play the first one.
function openFiles(paths) {
  if (!paths.length) return;
  addPaths(paths);
  const first = items.find(x => x.path.toLowerCase() === paths[0].toLowerCase());
  if (!first) return;
  if (outputReady) playItem(first); else { playWhenReady = first; selectedId = first.id; renderList(); }
}
api.onOpenFiles(openFiles);

function applyOutputSettings() {
  cmd('blackOnEnd', { on: $('blackOnEnd').checked });
  cmd('volume', { v: settings.volume ?? 1 });
  cmd('mute', { m: !!settings.muted });
  cmd('aspect', { mode: aspect });
  if (settings.sinkId) cmd('sink', { id: settings.sinkId });
}

// ---------- displays ----------
function renderDisplays() {
  if (!displays) return;
  const d = displays;
  $('displaySel').innerHTML = d.list.map(x =>
    `<option value="${x.id}" ${x.id === d.current ? 'selected' : ''}>${escapeHtml(t('screenN', { n: x.index }))} — ⁦${x.width}×${x.height}⁩${x.primary ? ' ' + escapeHtml(t('primary')) : ''}</option>`).join('');
  $('fullBtn').querySelector('span').textContent = d.fullscreen ? t('windowed') : t('fullscreen');
  const onPrimary = d.list.find(x => x.id === d.current)?.primary;
  $('fullBtn').style.display = onPrimary ? '' : 'none';
}
api.onDisplays(d => { displays = d; renderDisplays(); });
$('displaySel').addEventListener('change', e => api.setOutputDisplay(Number(e.target.value)));
$('fullBtn').addEventListener('click', () => api.toggleOutputFullscreen());

// ---------- audio output ----------
async function loadSinks() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    const sel = $('sinkSel');
    sel.innerHTML = `<option value="">${escapeHtml(t('defaultDevice'))}</option>` + devs.map((d, i) => `<option value="${d.deviceId}">${escapeHtml(d.label || t('audioDevice', { n: i + 1 }))}</option>`).join('');
    sel.value = devs.some(d => d.deviceId === settings.sinkId) ? settings.sinkId : '';
  } catch (e) { console.warn(e); }
}
navigator.mediaDevices.addEventListener('devicechange', loadSinks);
$('sinkSel').addEventListener('change', e => {
  settings.sinkId = e.target.value; api.setSetting('sinkId', e.target.value);
  cmd('sink', { id: e.target.value });
});

// ---------- controls ----------
$('playBtn').onclick = togglePlay;
$('prevBtn').onclick = prevItem;
$('nextBtn').onclick = nextItem;
$('backBtn').onclick = () => cmd('seekBy', { d: -10 });
$('fwdBtn').onclick = () => cmd('seekBy', { d: 10 });
$('stopBtn').onclick = () => cmd('stop');
$('blackBtn').onclick = () => cmd('black', { on: !out.black });
$('muteBtn').onclick = toggleMute;
$('vol').addEventListener('input', e => setVolume(e.target.value / 100));
$('vol').addEventListener('change', e => e.target.blur());

$('seek').addEventListener('input', e => {
  seeking = true;
  setFill(e.target);
  $('tCur').textContent = fmt((e.target.value / 1000) * out.duration);
});
$('seek').addEventListener('change', e => {
  cmd('seek', { t: (e.target.value / 1000) * out.duration });
  seeking = false; e.target.blur();
});

$('rateSel').addEventListener('change', e => { cmd('rate', { r: parseFloat(e.target.value) }); e.target.blur(); });
$('aspectSel').addEventListener('change', e => { setAspect(e.target.value); e.target.blur(); });
$('loopChk').addEventListener('change', e => cmd('loop', { on: e.target.checked }));
$('autoNext').addEventListener('change', e => api.setSetting('autoNext', e.target.checked));
$('blackOnEnd').addEventListener('change', e => { api.setSetting('blackOnEnd', e.target.checked); cmd('blackOnEnd', { on: e.target.checked }); });

$('addFilesBtn').onclick = async () => addPaths(await api.pickFiles(t('pickTitle')));
$('folderBtn').onclick = () => api.openVideosFolder();
$('ytUpdateBtn').onclick = async () => {
  const b = $('ytUpdateBtn');
  b.disabled = true; b.textContent = t('updating');
  const msg = await api.updateYtdlp();
  b.disabled = false; b.textContent = t('updateYtdlp');
  toast(msg);
};

// ---------- YouTube downloads ----------
async function addStream(url) {
  if (items.some(x => x.source === 'stream' && x.url === url)) { toast(t('alreadyInList')); return; }
  const it = { id: uid(), source: 'stream', url, path: url, title: url, loading: true };
  items.push(it); selectedId = it.id; renderList();
  const r = await api.resolveStream(url);
  it.loading = false;
  if (!r.ok) {
    items = items.filter(x => x !== it); renderList();
    toast(r.error === 'LIVE' ? t('liveNotSupported') : t('streamFailed', { e: r.error }));
    return;
  }
  it.title = r.title; it.duration = r.duration;
  save(); renderList();
  toast(t('streamAdded', { t: r.title }));
}

// kind: 'video' or 'mp3'. replaceId turns a stream item into the downloaded file in place;
// afterId puts the new file right after an item (an MP3 next to its video).
function startDownload(url, kind, { replaceId, afterId, title } = {}) {
  const id = uid();
  downloads.set(id, { url, kind, replaceId, afterId, title: title || url, status: 'starting', percent: 0 });
  api.downloadStart(id, url, kind);
  renderDownloads();
}

function takeLink() {
  const url = $('ytUrl').value.trim();
  if (!/^https?:\/\//i.test(url)) { toast(t('invalidLink')); return null; }
  $('ytUrl').value = '';
  $('ytUrl').blur();
  return url;
}

$('ytForm').addEventListener('submit', e => {
  e.preventDefault();
  if (e.submitter?.id === 'downloadBtn') return; // opens its menu instead
  const url = takeLink();
  if (url) addStream(url);
});
$('downloadBtn').addEventListener('click', e => {
  e.preventDefault();
  if (!/^https?:\/\//i.test($('ytUrl').value.trim())) { toast(t('invalidLink')); return; }
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { label: t('downloadVideoOpt'), icon: 'i-download', action: () => { const url = takeLink(); if (url) startDownload(url, 'video'); } },
    { label: t('downloadMp3Opt'), icon: 'i-music', action: () => { const url = takeLink(); if (url) startDownload(url, 'mp3'); } },
  ]);
});

api.onDownload(d => {
  const cur = downloads.get(d.id);
  if (!cur) return;
  Object.assign(cur, d);
  if (d.status === 'done') {
    downloads.delete(d.id);
    const file = { title: d.title, path: d.path, audioPath: d.audioPath, source: 'youtube', url: cur.url };
    const at = items.findIndex(x => x.id === (cur.replaceId || cur.afterId));
    if (cur.replaceId && at >= 0) {
      items[at] = { ...file, id: items[at].id };
    } else if (!items.some(x => x.path.toLowerCase() === d.path.toLowerCase())) {
      items.splice(at >= 0 ? at + 1 : items.length, 0, { ...file, id: uid() });
    }
    save(); renderList(); probeDurations();
    toast(t('downloaded', { t: d.title }));
  }
  if (d.status === 'canceled') downloads.delete(d.id);
  renderDownloads();
});

// yt-dlp (~17 MB, first YouTube use) and FFmpeg (~28 MB, first MP3) download on demand; show it.
api.onToolSetup(({ tool, progress }) => {
  const done = progress >= 1;
  toast(tool === 'ffmpeg'
    ? (done ? t('mp3SetupDone') : t('mp3Setup', { n: Math.round(progress * 100) }))
    : (done ? t('ytSetupDone') : t('ytSetup', { n: Math.round(progress * 100) })));
});

function renderDownloads() {
  const box = $('downloads');
  box.innerHTML = '';
  for (const [id, d] of downloads) {
    const el = document.createElement('div');
    el.className = 'dl' + (d.status === 'error' ? ' error' : '');
    const meta = d.status === 'error' ? escapeHtml(t('dlFailed', { e: d.error || '' }))
      : d.status === 'downloading' ? `${d.percent.toFixed(1)}%  ·  ${escapeHtml(d.speed || '')}  ·  ${escapeHtml(d.eta || '')}`
      : escapeHtml(t('preparing'));
    el.innerHTML = `
      <div class="dl-top"><svg class="yt-ico" style="width:18px;height:18px"><use href="#i-yt"/></svg>
        <span class="dl-title" dir="auto">${escapeHtml(d.title)}</span>
        <button title="${escapeHtml(d.status === 'error' ? t('remove') : t('cancel'))}"><svg><use href="#i-x"/></svg></button></div>
      ${d.status === 'error' ? '' : `<div class="bar"><i style="width:${d.percent || 0}%"></i></div>`}
      <div class="dl-meta">${meta}</div>`;
    el.querySelector('button').onclick = () => {
      if (d.status === 'error') { downloads.delete(id); renderDownloads(); }
      else api.downloadCancel(id);
    };
    box.appendChild(el);
  }
}

// ---------- keyboard ----------
function handleKey(k) {
  const vol = out.muted ? 0 : out.volume;
  switch (k.code) {
    case 'Space': case 'KeyK': togglePlay(); break;
    case 'ArrowRight': cmd('seekBy', { d: k.shift ? 30 : 5 }); break;
    case 'ArrowLeft': cmd('seekBy', { d: k.shift ? -30 : -5 }); break;
    case 'KeyL': cmd('seekBy', { d: 10 }); break;
    case 'KeyJ': cmd('seekBy', { d: -10 }); break;
    case 'ArrowUp': toast(t('volumeToast', { n: Math.round(setVolume(vol + 0.05) * 100) })); break;
    case 'ArrowDown': toast(t('volumeToast', { n: Math.round(setVolume(vol - 0.05) * 100) })); break;
    case 'KeyM': toggleMute(); break;
    case 'KeyB': case 'Period': cmd('black', { on: !out.black }); break;
    case 'KeyN': case 'PageDown': nextItem(); break;
    case 'KeyP': case 'PageUp': prevItem(); break;
    case 'KeyA': setAspect(ASPECTS[(ASPECTS.indexOf(aspect) + 1) % ASPECTS.length], true); break;
    case 'Home': cmd('seek', { t: 0 }); break;
    case 'End': if (out.duration) cmd('seek', { t: out.duration - 0.1 }); break;
    case 'KeyF': api.toggleOutputFullscreen(); break;
    case 'Enter': case 'NumpadEnter': playItem(items.find(x => x.id === selectedId)); break;
    case 'Delete': if (selectedId) removeItem(selectedId); break;
    default: {
      const m = /^(?:Digit|Numpad)(\d)$/.exec(k.code);
      if (m && out.duration) { cmd('seek', { t: out.duration * Number(m[1]) / 10 }); return true; }
      return false;
    }
  }
  return true;
}
function moveSelection(delta) {
  if (!items.length) return;
  const i = items.findIndex(x => x.id === selectedId);
  const n = Math.max(0, Math.min(items.length - 1, (i < 0 ? (delta > 0 ? -1 : items.length) : i) + delta));
  selectedId = items[n].id; renderList();
  document.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
}

window.addEventListener('keydown', e => {
  const menu = document.getElementById('menu');
  if (menu) {
    const buttons = [...menu.querySelectorAll('button')];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') closeMenu();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    else if (e.key === 'Enter' && i >= 0) buttons[i].click();
    e.preventDefault();
    return;
  }
  const tag = e.target.tagName;
  if (tag === 'INPUT' && e.target.type === 'text') { if (e.key === 'Escape') e.target.blur(); return; }
  if (tag === 'SELECT') return;
  if (e.ctrlKey || e.altKey || e.metaKey) {
    if (e.ctrlKey && e.code === 'KeyO') { e.preventDefault(); $('addFilesBtn').click(); }
    return;
  }
  // Up/Down with Shift moves the playlist selection; plain Up/Down is volume.
  if (e.shiftKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); moveSelection(e.code === 'ArrowUp' ? -1 : 1); return; }
  if (handleKey({ code: e.code, shift: e.shiftKey })) e.preventDefault();
});
api.onOutputKey(k => handleKey(k));
// A focused button would also "click" on Space/Enter, toggling twice. Shortcuts own those keys.
window.addEventListener('keyup', e => { if (e.target.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) e.preventDefault(); });
// Mouse clicks shouldn't leave buttons focused.
document.addEventListener('click', e => { if (e.detail > 0) e.target.closest('button')?.blur(); });

// ---------- drag & drop files ----------
let dragDepth = 0;
const isFileDrag = e => !!e.dataTransfer && (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list'));
window.addEventListener('dragenter', e => { if (isFileDrag(e)) { dragDepth++; document.body.classList.add('dragging'); } });
window.addEventListener('dragleave', e => { if (isFileDrag(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', e => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0; document.body.classList.remove('dragging');
  const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  const files = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(Boolean);
  if (files.length) addPaths(files);
  else if (/youtu/.test(text)) { $('ytUrl').value = text.trim(); $('ytUrl').focus(); }
});

// ---------- init ----------
(async function init() {
  settings = await api.getSettings();
  $('autoNext').checked = !!settings.autoNext;
  $('blackOnEnd').checked = settings.blackOnEnd ?? true;
  items = (await api.loadPlaylist()).map(({ loading, ...it }) => it);
  setLang(settings.lang || 'en');
  renderVolume(settings.volume ?? 1, !!settings.muted);
  probeDurations();
  api.getDisplays();
  renderMaximized(await api.winIsMaximized());
  outputReady = await api.outputIsReady();
  startPreview();
  applyOutputSettings();
  openFiles(await api.takeOpenFiles());
})();
