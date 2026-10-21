const $ = id => document.getElementById(id);

// { id, title, path, source: 'file'|'youtube'|'stream', url?, duration?, missing?, thumbUrl?,
//   trim?: { start, end }, volume?, subs?, lyrics?, resumeAt? }
let items = [];
let selectedId = null;
let playingId = null;
let out = { loaded: false, paused: true, time: 0, duration: 0, volume: 1, muted: false, black: true };
let seeking = false;
let settings = {};
const downloads = new Map(); // id -> { url, title, status, percent, speed, eta, error }

const MAX_VOLUME = 2;      // 200%, like VLC
const ASPECTS = ['default', '16:9', '4:3', '16:10', '1:1', '5:4', '2.21:1', '2.35:1', '2.39:1', 'fill', 'crop'];
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
let aspect = 'default';
let rate = 1;
let sinks = [];            // audio outputs: [{ id, label }]

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cmd = (type, data = {}) => api.sendCmd({ type, ...data });

function fmt(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}
function baseName(p) { return p.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function aspectLabel(a) {
  return a === 'default' ? t('aspectDefault') : a === 'fill' ? t('aspectFill') : a === 'crop' ? t('aspectCrop') : a;
}

// Toasts are kept for errors and the few things that finish in the background.
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- language ----------
function setLang(lang) {
  applyLang(lang);
  settings.lang = LANG; api.setSetting('lang', LANG);
  document.querySelector('.tip')?.classList.remove('show'); // a tooltip in the old language
  renderMode(); loadSinks(); renderList(); renderState(); renderDownloads(); renderUpdate(); renderVocalJobs?.();
}

// ---------- theme: same as Windows, light or dark ----------
const THEMES = ['system', 'light', 'dark'];
function setTheme(th) {
  settings.theme = THEMES.includes(th) ? th : 'system';
  api.setTheme(settings.theme);
}

// ---------- side panel: drag the edge to resize, Ctrl+B or the button to hide ----------
const SIDE_MIN = 260, SIDE_MAX = 560;
const clampSide = w => Math.max(SIDE_MIN, Math.min(SIDE_MAX, Math.round(w)));
function applySide() {
  document.body.classList.toggle('side-hidden', !!settings.sidebarHidden);
  if (settings.sidebarWidth) document.body.style.setProperty('--side-w', clampSide(settings.sidebarWidth) + 'px');
  else document.body.style.removeProperty('--side-w');
  $('sideBtn').classList.toggle('on', !settings.sidebarHidden);
  // The preview box can move without changing size, which the ResizeObserver doesn't see.
  requestAnimationFrame(() => sendPlayerRect());
}
function toggleSide() {
  settings.sidebarHidden = !settings.sidebarHidden;
  api.setSetting('sidebarHidden', settings.sidebarHidden);
  applySide();
}
$('sideBtn').onclick = toggleSide;
$('sideGrip').addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing');
  const rtl = document.documentElement.dir === 'rtl';
  const move = ev => {
    const w = rtl ? ev.clientX : window.innerWidth - ev.clientX;
    settings.sidebarWidth = clampSide(w);
    applySide();
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    document.body.classList.remove('resizing');
    api.setSetting('sidebarWidth', settings.sidebarWidth);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up, { once: true });
  grip.addEventListener('pointercancel', up, { once: true });
});
$('sideGrip').addEventListener('dblclick', () => {
  settings.sidebarWidth = null; api.setSetting('sidebarWidth', null); applySide();
});

// ---------- where the video shows ("Show on") ----------
// No other screen chosen → Player: the video plays inside this window, over the preview box.
// Other screens chosen → Presenter: full screen there, and the box shows a live preview of it.
let modeState = { mode: 'player', canPresent: false, fullscreen: false, showOn: { screens: [], here: false }, screens: [] };
function renderMode() {
  const m = modeState;
  document.body.classList.toggle('player-mode', m.mode === 'player');
  $('fullBtn').hidden = m.mode !== 'player';
  $('showOnBtn').hidden = !m.canPresent;
  $('showOnLabel').textContent = showOnLabel();
  if (document.querySelector('#menu.showon')) renderShowOnMenu();
  sendPlayerRect();
  renderStatus();
  if (m.mode === 'presenter') startPreview();
}
api.onMode(m => { modeState = m; renderMode(); });
$('fullBtn').onclick = () => api.playerFullscreen(!modeState.fullscreen);

const screenNo = id => modeState.screens.find(x => x.id === id)?.n;
const hereScreen = () => modeState.screens.find(x => x.here);
function showOnLabel() {
  const { showOn: s, screens } = modeState;
  if (!s.screens.length) return t('showThisWindow');
  if (s.here && s.screens.length === screens.length - 1) return t('showAllScreens');
  const ns = [...s.screens.map(screenNo), ...(s.here ? [hereScreen()?.n] : [])].filter(Boolean).sort();
  return ns.map(n => t('screenN', { n })).join(' + ');
}
function setShowOn(screens, here) {
  // The controls' screen alone is just Player mode inside this window.
  if (!screens.length) here = false;
  api.setShowOn({ screens, here });
}

// The menu: a map of the screens laid out like Windows' display settings. Click a screen to add
// or remove it; the quick choices below cover the usual cases.
function openShowOn() {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu showon';
  menu.id = 'menu';
  document.body.appendChild(menu);
  renderShowOnMenu();
  const b = $('showOnBtn').getBoundingClientRect(), r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(b.left + b.width / 2 - r.width / 2, innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, b.top - r.height - 8) + 'px';
  sendPlayerRect();
  api.identifyScreens();
}
function renderShowOnMenu() {
  const menu = document.querySelector('#menu.showon');
  if (!menu) return;
  const { showOn: s, screens } = modeState;
  const on = x => (x.here ? s.here && s.screens.length > 0 : s.screens.includes(x.id));
  const minX = Math.min(...screens.map(x => x.bounds.x)), minY = Math.min(...screens.map(x => x.bounds.y));
  const W = Math.max(...screens.map(x => x.bounds.x + x.bounds.width)) - minX;
  const H = Math.max(...screens.map(x => x.bounds.y + x.bounds.height)) - minY;
  const k = Math.min(300 / W, 120 / H);
  const gap = 6;
  menu.innerHTML = `
    <div class="so-head"><b>${escapeHtml(t('showOn'))}</b><span>${escapeHtml(t('showOnHint'))}</span></div>
    <div class="so-map" dir="ltr" style="width:${Math.round(W * k)}px;height:${Math.round(H * k)}px">
      ${screens.map(x => `<button class="so-screen ${on(x) ? 'on' : ''}" data-id="${x.id}" style="left:${Math.round((x.bounds.x - minX) * k) + gap / 2}px;top:${Math.round((x.bounds.y - minY) * k) + gap / 2}px;width:${Math.round(x.bounds.width * k) - gap}px;height:${Math.round(x.bounds.height * k) - gap}px">
        <b>${x.n}</b><small>${escapeHtml(x.here ? t('thisScreen') : `${x.width}×${x.height}`)}</small></button>`).join('')}
    </div>
    <div class="so-quick">
      <button data-q="window" class="${!s.screens.length ? 'on' : ''}">${escapeHtml(t('showThisWindow'))}</button>
      <button data-q="projector" class="${s.screens.length === 1 && !s.here ? 'on' : ''}">${escapeHtml(t('showProjector'))}</button>
      <button data-q="all" class="${s.here && s.screens.length === screens.length - 1 ? 'on' : ''}">${escapeHtml(t('showAllScreens'))}</button>
    </div>`;
  const others = screens.filter(x => !x.here).map(x => x.id);
  for (const b of menu.querySelectorAll('.so-screen')) b.onclick = () => {
    const x = screens.find(y => y.id === Number(b.dataset.id));
    if (x.here) {
      // This screen joins only next to another one (alone, it's just the window).
      if (s.screens.length) setShowOn(s.screens, !s.here); else setShowOn([], false);
    } else {
      const list = s.screens.includes(x.id) ? s.screens.filter(id => id !== x.id) : [...s.screens, x.id];
      setShowOn(list, s.here);
    }
  };
  for (const b of menu.querySelectorAll('[data-q]')) b.onclick = () => {
    if (b.dataset.q === 'window') setShowOn([], false);
    else if (b.dataset.q === 'projector') setShowOn([s.screens[0] ?? others[0]], false);
    else setShowOn(others, true);
  };
}
$('showOnBtn').onclick = () => (document.querySelector('#menu.showon') ? closeMenu() : openShowOn());

// ---------- freeze and frame by frame ----------
$('freezeBtn').onclick = () => cmd('freeze', { on: !out.frozen });
// Frozen in Presenter mode: the preview shows the running video from small live frames.
let liveUrl = null;
api.onLiveFrame(frame => {
  const img = $('liveFrame');
  if (liveUrl) URL.revokeObjectURL(liveUrl);
  liveUrl = frame ? URL.createObjectURL(new Blob([frame], { type: 'image/jpeg' })) : null;
  img.hidden = !liveUrl;
  if (liveUrl) img.src = liveUrl; else img.removeAttribute('src');
});
// One frame per click; held down, it keeps stepping.
for (const [id, n] of [['frameBackBtn', -1], ['frameFwdBtn', 1]]) {
  const b = $(id);
  let hold = null;
  const stop = () => { clearTimeout(hold); clearInterval(hold); hold = null; };
  b.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    stop();
    cmd('frame', { n });
    hold = setTimeout(() => { hold = setInterval(() => cmd('frame', { n }), 70); }, 400);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
  b.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); cmd('frame', { n }); } });
}

// Tell the main process where the preview box is, so the video sits exactly on it. The video is a
// separate layer above this page, so it steps aside while a dialog or a menu covers the box, for
// audio-only items, and while nothing is loaded (the page shows how to start there instead).
let lastPlayerRect = '';
// The page can't draw over the video layer, so a menu over the box would be hidden behind it.
// Instead of hiding the video, it shrinks into the largest part of the box the menu leaves free.
function uncoveredPart(box) {
  const m = document.getElementById('menu')?.getBoundingClientRect();
  if (!m || !(m.left < box.right && m.right > box.left && m.top < box.bottom && m.bottom > box.top)) return box;
  const parts = [
    { left: box.left, top: box.top, right: m.left - 6, bottom: box.bottom },
    { left: m.right + 6, top: box.top, right: box.right, bottom: box.bottom },
    { left: box.left, top: box.top, right: box.right, bottom: m.top - 6 },
    { left: box.left, top: m.bottom + 6, right: box.right, bottom: box.bottom },
  ].map(p => ({ ...p, area: Math.max(0, p.right - p.left) * Math.max(0, p.bottom - p.top) }));
  const best = parts.sort((a, b) => b.area - a.area)[0];
  return best.area > (box.right - box.left) * (box.bottom - box.top) * 0.12 ? best : null;
}
const videoCovered = () => !$('modal').hidden || !out.loaded || out.audioOnly;
function playerRectNow() {
  const r = document.querySelector('.preview').getBoundingClientRect();
  if (videoCovered() || !r.width) return null;
  const p = uncoveredPart({ left: r.left + 2, top: r.top + 2, right: r.right - 2, bottom: r.bottom - 2 });
  return p ? { x: p.left, y: p.top, width: p.right - p.left, height: p.bottom - p.top } : null;
}
function sendPlayerRect() {
  if (modeState.mode !== 'player') return;
  const rect = playerRectNow();
  lastPlayerRect = JSON.stringify(rect);
  api.playerRect(rect);
}
// The box can also move without changing size (language switch, side panel): catch any move.
setInterval(() => {
  if (modeState.mode === 'player' && JSON.stringify(playerRectNow()) !== lastPlayerRect) sendPlayerRect();
}, 200);
new ResizeObserver(sendPlayerRect).observe(document.querySelector('.preview'));
window.addEventListener('resize', sendPlayerRect);
new MutationObserver(sendPlayerRect).observe($('modal'), { attributes: true, attributeFilter: ['hidden'] });

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

// ---------- dialogs ----------
// openModal(html) shows a dialog; Esc, a click on the backdrop and [data-close] buttons close it.
function openModal(html, { cls = '', onClose } = {}) {
  const box = $('modal');
  box.innerHTML = `<div class="modal-box ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  box.hidden = false;
  box._onClose = onClose || null;
  box.onmousedown = e => { if (e.target === box) closeModal(); };
  for (const b of box.querySelectorAll('[data-close]')) b.onclick = closeModal;
  return box.firstElementChild;
}
function closeModal() {
  const box = $('modal');
  if (box.hidden) return;
  const fn = box._onClose;
  box.hidden = true; box.innerHTML = ''; box._onClose = null;
  fn?.();
}

// ---------- About (the ⓘ next to the name) ----------
const REPO_URL = 'https://github.com/michaelsaad/ma3madan-play';
async function showAbout() {
  const version = await api.appVersion();
  openModal(`
      <img src="assets/app-128.png" alt="" class="about-icon">
      <h2>${escapeHtml(t('appName'))}</h2>
      <div class="muted" dir="ltr">${escapeHtml(t('versionN', { v: version }))}</div>
      <p>${escapeHtml(t('aboutName'))}</p>
      <div class="about-features">
        <p>${escapeHtml(t('aboutText'))}</p>
        <ul>${['aboutF1', 'aboutF4', 'aboutF2', 'aboutF3'].map(k => `<li>${escapeHtml(t(k))}</li>`).join('')}</ul>
      </div>
      <div class="about-actions">
        <button id="aboutGithub" class="primary"><svg><use href="#i-github"/></svg><span>${escapeHtml(t('aboutGithub'))}</span></button>
        <button id="aboutCheck"><svg><use href="#i-download"/></svg><span>${escapeHtml(t('checkUpdates'))}</span></button>
      </div>
      <div id="aboutStatus" class="muted small" aria-live="polite"></div>
      <div class="modal-actions"><button id="aboutClose" class="ghost" data-close>${escapeHtml(t('close'))}</button></div>`, { cls: 'about' });
  $('aboutGithub').onclick = () => api.openExternal(REPO_URL);
  $('aboutCheck').onclick = async () => {
    const b = $('aboutCheck'), status = $('aboutStatus');
    b.disabled = true; status.textContent = t('checking');
    const r = await api.checkForUpdate();
    b.disabled = false;
    status.textContent = !r.ok ? t('checkFailed') : r.info ? t('updateFound', { v: r.info.version }) : t('upToDate');
  };
  $('aboutClose').focus();
}
$('aboutBtn').onclick = showAbout;
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
const save = () => { api.savePlaylist(items); pushRemote(); };

function addPaths(paths) {
  const existing = new Map(items.map(i => [i.path.toLowerCase(), i]));
  const added = [];
  for (const p of paths) {
    const found = existing.get(p.toLowerCase());
    if (found) { added.push(found); continue; }
    const it = { id: uid(), title: baseName(p), path: p, source: 'file' };
    items.push(it); existing.set(p.toLowerCase(), it);
    added.push(it);
  }
  if (added.length) {
    addToActiveList(added.map(x => x.id)); // features.js
    save(); renderList(); probeDurations();
  }
  return added;
}

const AUDIO_RE = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|weba)$/i;
const isAudio = it => it.source !== 'stream' && AUDIO_RE.test(it.path);
const lyricSlides = it => (it?.lyrics || '').replace(/\r/g, '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);

function itemSub(it) {
  if (it.loading) return escapeHtml(t('loading'));
  if (it.missing) return escapeHtml(t('fileMissing'));
  const kind = it.source === 'stream' ? t('streamOnline') : it.source === 'youtube' ? t('youtube') : '';
  const bits = [kind, isAudio(it) ? t('audioLabel') : '', it.stems && it.stemsOn ? t('karaokeLabel') : ''].filter(Boolean).map(escapeHtml);
  const tags = [];
  if (it.trim && (it.trim.start || it.trim.end)) tags.push(`<i class="tag" title="${escapeHtml(t('trimmed'))}" dir="ltr">${fmt(it.trim.start || 0)}–${it.trim.end ? fmt(it.trim.end) : fmt(it.duration)}</i>`);
  if (it.volume && it.volume !== 1) tags.push(`<i class="tag" dir="ltr">${Math.round(it.volume * 100)}%</i>`);
  if (lyricSlides(it).length) tags.push(`<i class="tag ico" title="${escapeHtml(t('lyrics'))}"><svg><use href="#i-lyrics"/></svg></i>`);
  if (it.subs) tags.push(`<i class="tag ico" title="${escapeHtml(t('subtitles'))}"><svg><use href="#i-cc"/></svg></i>`);
  return bits.join(' · ') + (tags.length ? ' ' + tags.join('') : '');
}

function thumbHtml(it) {
  if (it.thumbUrl) return `<span class="item-thumb" style="background-image:url('${escapeHtml(it.thumbUrl)}')"></span>`;
  const icon = isAudio(it) ? 'i-music' : it.source === 'stream' ? 'i-yt' : 'i-play';
  return `<span class="item-thumb empty"><svg><use href="#${icon}"/></svg></span>`;
}

function renderList() {
  const ol = $('playlist');
  const all = viewItems(); // features.js: the open list, or Recents
  const q = (searchQuery || '').trim().toLowerCase();
  const shown = q ? all.filter(it => it.title.toLowerCase().includes(q)) : all;
  ol.innerHTML = '';
  shown.forEach(it => {
    const li = document.createElement('li');
    const i = all.indexOf(it);
    li.className = 'item' + (it.id === selectedId ? ' selected' : '') + (it.id === playingId ? ' playing' : '') + (it.missing ? ' missing' : '');
    li.draggable = !q;
    li.dataset.id = it.id;
    const idx = it.id === playingId ? `<svg><use href="#${out.paused ? 'i-pause' : 'i-play'}"/></svg>` : (i + 1);
    li.innerHTML = `
      <span class="item-idx">${idx}</span>
      ${thumbHtml(it)}
      <span class="item-main"><div class="item-title" dir="auto" title="${escapeHtml(it.source === 'stream' ? it.url : it.path)}">${escapeHtml(it.title)}</div><div class="item-sub">${itemSub(it)}</div></span>
      <span class="item-dur" dir="ltr">${it.duration ? fmt(it.duration) : ''}</span>
      <button class="item-more" title="${escapeHtml(t('more'))}"><svg><use href="#i-more"/></svg></button>`;
    li.addEventListener('click', e => {
      // Measure the ⋯ button before the list is redrawn: afterwards it's a detached element at 0,0.
      const r = e.target.closest('.item-more')?.getBoundingClientRect();
      selectedId = it.id; renderList();
      if (r) showItemMenu(it, r.left, r.bottom + 4);
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
      moveItem(from, it.id); // features.js: within the open list, or Recents
      renderList();
    });
    ol.appendChild(li);
  });
  $('emptyList').style.display = shown.length ? 'none' : '';
  $('emptyListText').textContent = q ? t('noMatches') : activeList() ? t('emptyListList') : t('emptyList');
  $('listCount').textContent = all.length ? (all.length === 1 ? t('videoOne') : t('videosCount', { n: all.length })) : '';
  renderNow();
  renderEmptyState();
  renderListHead(); // features.js
  pushRemote();
}

// ---------- pop-up menu (playlist items, Download button, lists) ----------
// entries: [{ label, icon?, action, danger?, checked?, hint? }], '-' for a divider and
// { heading } for a small title.
function showMenu(x, y, entries, { cls = '' } = {}) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu ' + cls;
  menu.id = 'menu';
  for (const e of entries) {
    if (e === '-') { menu.appendChild(document.createElement('hr')); continue; }
    if (e.heading) { const h = document.createElement('div'); h.className = 'menu-head'; h.textContent = e.heading; menu.appendChild(h); continue; }
    const b = document.createElement('button');
    b.className = (e.danger ? 'danger' : '') + (e.checked ? ' checked' : '');
    b.innerHTML = `${e.icon ? `<svg><use href="#${e.icon}"/></svg>` : '<i></i>'}<span>${escapeHtml(e.label)}</span>${e.hint ? `<kbd>${escapeHtml(e.hint)}</kbd>` : ''}`;
    b.onclick = () => { closeMenu(); e.action(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  menu.querySelector('button')?.focus();
  sendPlayerRect();
}
function closeMenu() {
  const menu = document.getElementById('menu');
  if (!menu) return;
  menu.remove();
  sendPlayerRect();
}
document.addEventListener('mousedown', e => { if (!e.target.closest('#menu')) closeMenu(); });
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

function showItemMenu(it, x, y) {
  const entries = [{ label: t('menuPlay'), icon: 'i-play', action: () => playItem(it) },
    { label: t('menuItemSettings'), icon: 'i-sliders', action: () => showItemSettings(it) }];
  if (it.id === playingId && out.loaded) {
    entries.push({ label: t('menuStartHere'), icon: 'i-frame-fwd', hint: 'I', action: () => setTrimHere('start') },
      { label: t('menuEndHere'), icon: 'i-frame-back', hint: 'O', action: () => setTrimHere('end') });
  }
  entries.push('-', ...listMenuEntries(it)); // features.js
  if (it.source === 'stream') {
    entries.push('-',
      { label: t('menuDownloadVideo'), icon: 'i-download', action: () => startDownload(it.url, 'video', { replaceId: it.id, title: it.title }) },
      { label: t('menuDownloadMp3'), icon: 'i-music', action: () => startDownload(it.url, 'mp3', { afterId: it.id, title: it.title }) },
      { label: t('menuOpenLink'), icon: 'i-yt', action: () => api.openExternal(it.url) });
  } else {
    entries.push('-', { label: t('menuShowFile'), icon: 'i-folder', action: () => api.showInFolder(it.path) });
    if (it.url) {
      if (!isAudio(it)) entries.push({ label: t('menuDownloadMp3'), icon: 'i-music', action: () => startDownload(it.url, 'mp3', { afterId: it.id, title: it.title }) });
      entries.push({ label: t('menuOpenLink'), icon: 'i-yt', action: () => api.openExternal(it.url) });
    }
  }
  entries.push(...vocalMenuEntries(it)); // vocals-ui.js
  entries.push('-', { label: t('removeFromList'), icon: 'i-x', danger: true, action: () => removeItem(it.id) });
  showMenu(x, y, entries);
}

function removeItem(id) {
  items = items.filter(x => x.id !== id);
  forgetInLists(id); // features.js
  api.thumbDelete(id);
  if (selectedId === id) selectedId = null;
  save(); renderList();
}

// Read durations (and make thumbnails) one at a time with a hidden <video>.
let probing = false;
async function probeDurations() {
  if (probing) return;
  probing = true;
  const probe = $('probe');
  for (const it of [...items]) {
    if (it.missing || it.source === 'stream') continue;
    const needThumb = !it.thumbUrl && !isAudio(it);
    if (it.duration && !needThumb) continue;
    probe.src = await api.fileUrl(it.path);
    const d = await new Promise(res => {
      const done = v => { probe.onloadedmetadata = probe.onerror = null; res(v); };
      probe.onloadedmetadata = () => done(probe.duration);
      probe.onerror = () => done(0);
      setTimeout(() => done(0), 8000);
    });
    if (d && isFinite(d) && !it.duration) { it.duration = d; renderList(); }
    if (needThumb && d && probe.videoWidth) await makeThumb(it, probe, d);
  }
  probe.removeAttribute('src'); probe.load();
  probing = false;
  save();
}
// A frame a little way in (the very first frame is often black).
async function makeThumb(it, video, duration) {
  const at = Math.min(duration * 0.12, 25);
  const ok = await new Promise(res => {
    const done = v => { video.onseeked = video.onerror = null; res(v); };
    video.onseeked = () => done(true);
    video.onerror = () => done(false);
    video.currentTime = at;
    setTimeout(() => done(false), 6000);
  });
  if (!ok || !video.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = 192; c.height = Math.round(192 * video.videoHeight / video.videoWidth);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  if (!blob) return;
  it.thumbUrl = await api.thumbSave(it.id, new Uint8Array(await blob.arrayBuffer()));
  renderList();
}

// ---------- playback ----------
let streamRetried = null;  // item id already re-resolved after a playback error
let playingListId = null;  // the list the playing video was started from (Next follows it)
let resumedFrom = null;    // { id, at } when the last start picked up where it was left
const srtToVtt = text => (/^\uFEFF?WEBVTT/.test(text) ? text
  : 'WEBVTT\n\n' + text.replace(/\r/g, '').replace(/^\uFEFF/, '').replace(/(\d\d:\d\d:\d\d),(\d{3})/g, '$1.$2'));

const RESUME_MIN_DURATION = 180; // only longer videos pick up where they were left
function canResume(it) { return settings.resume !== false && (it.duration || 0) >= RESUME_MIN_DURATION; }
// Remember where the playing video is, so it can continue there next time. True when it changed.
function rememberPosition() {
  const it = items.find(x => x.id === playingId);
  if (!it || !out.loaded || !canResume(it)) return false;
  const start = it.trim?.start || 0, end = it.trim?.end || it.duration || 0;
  const at = out.time;
  const keep = at > start + 15 && (!end || at < end - 15) && !out.ended;
  const next = keep ? Math.floor(at) : 0;
  if ((it.resumeAt || 0) === next) return false;
  it.resumeAt = next;
  return true;
}
setInterval(() => { if (out.loaded && !out.paused && rememberPosition()) api.savePlaylist(items); }, 15000);
window.addEventListener('beforeunload', () => { rememberPosition(); api.savePlaylist(items); });

async function playItem(it, { autoplay = true, force = false, startAt = null } = {}) {
  if (!it) return;
  if (it.missing) { toast(t('fileMissing')); return; }
  if (it.loading) return;
  if (playingId && playingId !== it.id && rememberPosition()) save();
  const listCtx = activeList()?.itemIds.includes(it.id) ? activeList().id : null;
  playingId = it.id; selectedId = it.id; playingListId = listCtx;
  if (!force) streamRetried = null;
  resumedFrom = null;
  if (startAt == null && canResume(it) && it.resumeAt) { startAt = it.resumeAt; resumedFrom = { id: it.id, at: it.resumeAt }; }
  let src;
  if (it.source === 'stream') {
    it.loading = true; renderList();
    const r = await api.resolveStream(it.url, force);
    it.loading = false;
    if (!r.ok) { renderList(); toast(r.error === 'LIVE' ? t('liveNotSupported') : t('streamFailed', { e: r.error })); return; }
    if (it.title !== r.title || it.duration !== r.duration) { it.title = r.title; it.duration = r.duration; save(); }
    if (!it.thumbUrl && r.thumbnail) api.thumbFetch(it.id, r.thumbnail).then(u => { if (u) { it.thumbUrl = u; renderList(); } });
    if (playingId !== it.id) return; // something else was started meanwhile
    src = { path: it.path, ladder: r.ladder, quality: settings.streamQuality || 'auto', speed: await api.streamSpeed() };
  } else {
    src = { path: it.path, url: await api.fileUrl(it.path), audioUrl: it.audioPath ? await api.fileUrl(it.audioPath) : null };
    if (it.stems && it.stemsOn) {
      // Vocal remover on: the separated music and vocals replace the original sound, mixed live.
      src.stems = { music: await api.fileUrl(it.stems.music), vocals: await api.fileUrl(it.stems.vocals) };
      src.mix = it.mix || { music: 1, vocals: 0 };
    }
    // Subtitles: the file chosen for this video, or a .srt/.vtt with the same name next to it.
    const subsPath = it.subs === false || isAudio(it) ? null : it.subs || await api.findSubs(it.path);
    const text = subsPath ? await api.readSubs(subsPath) : null;
    if (text) src.subs = srtToVtt(text);
    if (playingId !== it.id) return;
  }
  cmd('lyrics', { text: null });
  currentLyric = -1; // features.js
  cmd('load', { ...src, audio: isAudio(it), autoplay, startAt, trim: it.trim || null, itemVolume: it.volume || 1, volume: settings.volume ?? 1, muted: !!settings.muted });
  cmd('rate', { r: rate });
  cmd('loop', { on: $('loopChk').checked });
  cmd('subs', { on: settings.subsOn !== false });
  renderList();
  renderResume();
}

// The order Next and Previous follow: the list the video was started from, or Recents.
function queueItems() {
  const l = playingListId && lists.find(x => x.id === playingListId);
  return l ? l.itemIds.map(id => items.find(x => x.id === id)).filter(Boolean) : items;
}
function nextItem() {
  const q = queueItems(), i = q.findIndex(x => x.id === playingId);
  const n = q.slice(i + 1).find(x => !x.missing);
  if (n) playItem(n); else toast(t('lastVideo'));
}
function prevItem() {
  const q = queueItems(), i = q.findIndex(x => x.id === playingId);
  const start = out.trim?.start || 0;
  if (out.time - start > 3 && i >= 0) { cmd('seek', { t: start }); return; }
  const p = q.slice(0, Math.max(i, 0)).reverse().find(x => !x.missing);
  if (p) playItem(p); else cmd('seek', { t: start });
}
function togglePlay() {
  if (!out.loaded) {
    const it = items.find(x => x.id === selectedId) || viewItems().find(x => !x.missing);
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
function setAspect(a) {
  aspect = a;
  cmd('aspect', { mode: a });
  renderChips();
}
function setRate(r) {
  rate = r;
  cmd('rate', { r });
  renderChips();
}
function setSubsOn(on) {
  settings.subsOn = on; api.setSetting('subsOn', on);
  cmd('subs', { on });
}

// Start and end points for the playing video ("I" and "O", like video editors).
function setTrimHere(which) {
  const it = items.find(x => x.id === playingId);
  if (!it || !out.loaded) return;
  const trim = { start: it.trim?.start || 0, end: it.trim?.end || 0 };
  const at = Math.round(out.time * 10) / 10;
  if (which === 'start') { trim.start = at; if (trim.end && trim.end <= at) trim.end = 0; }
  else { trim.end = at; if (trim.start >= at) trim.start = 0; }
  setTrim(it, trim);
}
function setTrim(it, trim) {
  it.trim = trim && (trim.start || trim.end) ? { start: trim.start || 0, end: trim.end || 0 } : null;
  if (it.id === playingId && out.loaded) cmd('trim', it.trim || { start: 0, end: 0 });
  save(); renderList();
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

// The current title fills its own line. A title too long for it fades out at the edge and,
// on hover, scrolls to show the rest. Only rewritten when it changes, so a hover isn't reset.
function setNowTitle(text) {
  const box = $('nowTitle'), span = box.firstElementChild;
  if (span.textContent === text) return;
  span.textContent = text;
  span.style.transition = 'none';
  span.style.transform = '';
  requestAnimationFrame(() => box.classList.toggle('overflowing', span.scrollWidth > box.clientWidth + 1));
}
$('nowTitle').addEventListener('mouseenter', () => {
  const box = $('nowTitle'), span = box.firstElementChild;
  const extra = span.scrollWidth - box.clientWidth;
  if (extra <= 1) return;
  const rtl = getComputedStyle(span).direction === 'rtl';
  span.style.transition = `transform ${Math.max(1.5, extra / 60)}s linear .3s`;
  span.style.transform = `translateX(${rtl ? extra : -extra}px)`;
  box.classList.add('scrolled');
});
$('nowTitle').addEventListener('mouseleave', () => {
  const box = $('nowTitle'), span = box.firstElementChild;
  span.style.transition = 'transform .4s ease';
  span.style.transform = '';
  box.classList.remove('scrolled');
});
window.addEventListener('resize', () => { const box = $('nowTitle'), s = box.firstElementChild; box.classList.toggle('overflowing', s.scrollWidth > box.clientWidth + 1); });

function nextUp() {
  const q = queueItems(), i = q.findIndex(x => x.id === playingId);
  return i >= 0 ? q.slice(i + 1).find(x => !x.missing) : null;
}
function renderNow() {
  const it = items.find(x => x.id === playingId);
  setNowTitle(out.loaded && it ? it.title : t('nothingPlaying'));
  const n = nextUp();
  // <bdi> keeps an Arabic (or mixed) title from flipping the "Next:" label around it.
  const html = (out.buffering || it?.loading) ? escapeHtml(t('loading'))
    : (n ? `<span>${escapeHtml(t('next'))}</span>${n.thumbUrl ? `<i class="next-thumb" style="background-image:url('${escapeHtml(n.thumbUrl)}')"></i>` : ''}<bdi>${escapeHtml(n.title)}</bdi>` : '');
  if ($('nextTitle').innerHTML !== html) $('nextTitle').innerHTML = html;
}

// "Resumed from 12:30 · Start over" next to the title, instead of a toast.
let resumeTimer;
function renderResume() {
  const chip = $('resumeChip');
  clearTimeout(resumeTimer);
  chip.hidden = !(resumedFrom && resumedFrom.id === playingId);
  if (chip.hidden) return;
  chip.querySelector('span').textContent = t('resumedFrom', { t: fmt(resumedFrom.at) });
  resumeTimer = setTimeout(() => { resumedFrom = null; chip.hidden = true; }, 12000);
}
$('resumeChip').onclick = () => {
  const it = items.find(x => x.id === playingId);
  cmd('seek', { t: it?.trim?.start || 0 });
  if (it) { it.resumeAt = 0; save(); }
  resumedFrom = null; renderResume();
};

// What the audience sees right now, in a word, next to the title.
function renderStatus() {
  const pill = $('statusPill');
  let cls, text;
  const where = modeState.mode === 'presenter' ? showOnLabel() : '';
  if (out.countdown) { cls = 'cd'; text = t('stCountdown', { t: fmt(Math.ceil((out.countdown.until - Date.now()) / 1000)) }); }
  else if (!out.loaded) { cls = 'idle'; text = t('stStandby'); }
  else if (out.buffering) { cls = 'wait'; text = t('loading'); }
  else if (out.frozen) { cls = 'frozen'; text = t('stFrozen'); }
  else if (out.lyrics && (out.black || out.audioOnly)) { cls = 'lyr'; text = t('stLyrics'); }
  else if (out.black && !out.audioOnly) { cls = 'standby'; text = t('stStandby'); }
  else if (out.ended) { cls = 'idle'; text = t('stEnded'); }
  else if (out.paused) { cls = 'paused'; text = t('stPaused'); }
  else { cls = 'live'; text = out.audioOnly ? t('stAudio') : t('stLive'); }
  pill.className = 'status-pill ' + cls;
  const label = where ? `${text} · ${where}` : text;
  if (pill.querySelector('span').textContent !== label) pill.querySelector('span').textContent = label;
  if (!pill.dataset.tip) pill.title = t('tStatus');
}
setInterval(() => { if (out.countdown) renderStatus(); }, 500);

// What the preview box shows while nothing is playing: how to start.
function renderEmptyState() {
  const box = $('emptyState');
  box.hidden = out.loaded;
  if (out.loaded) return;
  const first = items.find(x => x.id === selectedId && !x.missing) || viewItems().find(x => !x.missing);
  $('esTitle').textContent = first ? t('esReadyTitle') : t('esStartTitle');
  $('esText').textContent = first ? t('esReadyText', { t: first.title }) : t('esStartText');
  $('esPaste').hidden = !!first;
  $('esAdd').hidden = !!first;
}
$('esAdd').onclick = () => $('addFilesBtn').click();
$('esPaste').onclick = () => { if (settings.sidebarHidden) toggleSide(); $('ytUrl').focus(); };

let lastAudioOnly = false, lastLoaded = false;
function renderState() {
  setIcon($('playBtn'), out.paused ? 'i-play' : 'i-pause');
  if (!seeking) {
    $('seek').value = out.duration ? Math.round((out.time / out.duration) * 1000) : 0;
    $('tCur').textContent = fmt(out.time);
  }
  setFill($('seek'));
  renderTrimMarks();
  $('tDur').textContent = fmt(out.duration);
  renderVolume(out.volume, out.muted);
  $('blackBtn').classList.toggle('on', !!out.black && !out.audioOnly);
  $('freezeBtn').classList.toggle('on', !!out.frozen);
  $('countdownBtn').classList.toggle('on', !!out.countdown);
  $('frozenBadge').hidden = !out.frozen;

  $('audioBadge').hidden = !(out.loaded && out.audioOnly);
  if (!!out.audioOnly !== lastAudioOnly || out.loaded !== lastLoaded) {
    lastAudioOnly = !!out.audioOnly; lastLoaded = out.loaded;
    sendPlayerRect(); renderEmptyState();
  }
  renderMixer(); // vocals-ui.js
  renderKaraokeBtn(); // vocals-ui.js
  renderLyricsBar(); // features.js
  renderMarks(); // features.js
  renderNow();
  renderStatus();
  renderChips();
  if (document.querySelector('#menu.playset')) renderPlaySettings();
  const idx = document.querySelector('.item.playing .item-idx use');
  if (idx) idx.setAttribute('href', out.paused ? '#i-pause' : '#i-play');
  pushRemote();
}

// The seek bar dims what lies outside the start and end points.
function renderTrimMarks() {
  let mask = document.querySelector('.trim-mask');
  if (!mask) { mask = document.createElement('div'); mask.className = 'trim-mask'; document.querySelector('.seek-track').prepend(mask); }
  const d = out.duration, tr = out.trim || {};
  const on = !!(d && (tr.start || tr.end));
  mask.hidden = !on;
  if (on) {
    mask.style.setProperty('--a', (tr.start / d) * 100 + '%');
    mask.style.setProperty('--b', (Math.min(tr.end || d, d) / d) * 100 + '%');
  }
  // Checkpoints: small ticks on the bar.
  let ticks = document.querySelector('.mark-ticks');
  if (!ticks) { ticks = document.createElement('div'); ticks.className = 'mark-ticks'; document.querySelector('.seek-track').prepend(ticks); }
  const it = items.find(x => x.id === playingId);
  const html = d && out.loaded && it?.marks?.length ? it.marks.map(m => `<i style="left:${(m.t / d) * 100}%"></i>`).join('') : '';
  if (ticks.innerHTML !== html) ticks.innerHTML = html;
}

// ---------- playback settings: one popover instead of four dropdowns ----------
// Only what differs from the usual shows as a chip next to the button.
function renderChips() {
  const chips = [];
  if (rate !== 1) chips.push({ k: 'rate', icon: 'i-speed', text: rate + '×' });
  if (aspect !== 'default') chips.push({ k: 'aspect', icon: 'i-aspect', text: aspectLabel(aspect) });
  if (out.loaded && out.qualities) {
    const q = out.upgrading ? `${out.quality} → ${out.upgrading}` : out.quality;
    chips.push({ k: 'quality', icon: 'i-hd', text: out.autoQuality ? `${t('qualityAuto')} · ${q}` : q, title: out.speedMbps ? t('speedNow', { n: out.speedMbps }) : '' });
  }
  if (out.loaded && out.subs) chips.push({ k: 'subs', icon: 'i-cc', text: out.subsOn ? t('subsOnShort') : t('subsOffShort'), off: !out.subsOn, title: t('tSubs') });
  const sink = sinks.find(s => s.id === settings.sinkId);
  if (sink) chips.push({ k: 'sink', icon: 'i-speaker', text: sink.label });
  const box = $('activeChips');
  const html = chips.map(c => `<button class="chip ${c.off ? 'off' : ''}" data-k="${c.k}" ${c.title ? `title="${escapeHtml(c.title)}"` : ''}><svg><use href="#${c.icon}"/></svg><span dir="auto">${escapeHtml(c.text)}</span></button>`).join('');
  if (box.dataset.html !== html) {
    box.dataset.html = html;
    box.innerHTML = html;
    for (const b of box.querySelectorAll('.chip')) b.onclick = () => (b.dataset.k === 'subs' ? setSubsOn(!out.subsOn) : openPlaySettings());
  }
}
function openPlaySettings() {
  if (document.querySelector('#menu.playset')) { closeMenu(); return; }
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu playset';
  menu.id = 'menu';
  document.body.appendChild(menu);
  renderPlaySettings();
  placePlaySettings();
  sendPlayerRect();
}
function placePlaySettings() {
  const menu = document.querySelector('#menu.playset');
  if (!menu) return;
  const b = $('playSetBtn').getBoundingClientRect(), r = menu.getBoundingClientRect();
  const rtl = document.documentElement.dir === 'rtl';
  menu.style.left = Math.max(8, Math.min(rtl ? b.left : b.right - r.width, innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, b.top - r.height - 8) + 'px';
}
function renderPlaySettings() {
  const menu = document.querySelector('#menu.playset');
  if (!menu) return;
  const seg = (k, opts, cur) => `<div class="seg wrap" data-k="${k}">${opts.map(([v, label]) => `<button data-v="${escapeHtml(v)}" class="${String(v) === String(cur) ? 'on' : ''}" dir="auto">${escapeHtml(label)}</button>`).join('')}</div>`;
  const section = (icon, title, body) => `<div class="ps-sec"><div class="ps-title"><svg><use href="#${icon}"/></svg><span>${escapeHtml(title)}</span></div>${body}</div>`;
  let html = section('i-speed', t('speed'), seg('rate', RATES.map(r => [r, r + '×']), rate));
  html += section('i-aspect', t('aspectRatio'), seg('aspect', ASPECTS.map(a => [a, aspectLabel(a)]), aspect));
  if (out.loaded && out.qualities) {
    const cur = out.autoQuality ? 'auto' : out.quality;
    html += section('i-hd', t('quality') + (out.speedMbps ? ` · ${t('speedNow', { n: out.speedMbps })}` : ''),
      seg('quality', [['auto', t('qualityAuto') + (out.autoQuality ? ` (${out.quality})` : '')], ...out.qualities.map(q => [q, q])], cur)
      + `<div class="ps-hint">${escapeHtml(t('qualityHint'))}</div>`);
  }
  if (out.loaded && out.subs) html += section('i-cc', t('subtitles'), seg('subs', [['on', t('on')], ['off', t('off')]], out.subsOn ? 'on' : 'off'));
  html += section('i-speaker', t('audioOut'), seg('sink', [['', t('defaultDevice')], ...sinks.map(s => [s.id, s.label])], settings.sinkId || ''));
  if (menu.dataset.html === html) return;
  const first = !menu.dataset.html;
  menu.dataset.html = html;
  menu.innerHTML = html;
  for (const s of menu.querySelectorAll('.seg')) for (const b of s.querySelectorAll('button')) b.onclick = () => {
    const v = b.dataset.v;
    if (s.dataset.k === 'rate') setRate(parseFloat(v));
    else if (s.dataset.k === 'aspect') setAspect(v);
    else if (s.dataset.k === 'quality') { settings.streamQuality = v; api.setSetting('streamQuality', v); cmd('quality', { q: v }); }
    else if (s.dataset.k === 'subs') setSubsOn(v === 'on');
    else if (s.dataset.k === 'sink') { settings.sinkId = v; api.setSetting('sinkId', v); cmd('sink', { id: v }); renderChips(); }
    renderPlaySettings();
  };
  if (!first) placePlaySettings();
}
$('playSetBtn').onclick = openPlaySettings;

api.onState(s => {
  const wasEnded = out.ended;
  const hadError = out.error;
  out = s;
  if (s.error && !hadError) {
    // Stream links expire; fetch a fresh one once and continue from the same spot.
    const it = items.find(x => x.id === playingId);
    if (it?.source === 'stream' && streamRetried !== it.id) { streamRetried = it.id; playItem(it, { force: true, startAt: s.time }); }
    else toast(t('playError'));
  }
  if (s.ended && !wasEnded) {
    // Watched to the end: next time it starts from the beginning.
    const it = items.find(x => x.id === playingId);
    if (it?.resumeAt) { it.resumeAt = 0; save(); }
  }
  renderState();
  if (s.ended && !wasEnded && !s.loop && $('autoNext').checked) nextItem();
});

// ---------- seek bar: hover shows the time and, for files on this PC, the picture there ----------
{
  const track = document.querySelector('.seek-track'), tip = $('scrubTip'), scrub = $('scrub'), cv = $('scrubCanvas');
  let scrubPath = null, want = null, busy = false;
  const draw = () => {
    if (busy || want == null) return;
    busy = true;
    const at = want; want = null;
    const finish = () => { scrub.onseeked = null; busy = false; draw(); };
    scrub.onseeked = () => {
      if (scrub.videoWidth) {
        cv.height = Math.round(cv.width * scrub.videoHeight / scrub.videoWidth);
        cv.getContext('2d').drawImage(scrub, 0, 0, cv.width, cv.height);
      }
      finish();
    };
    scrub.currentTime = at;
    setTimeout(() => { if (busy) finish(); }, 800);
  };
  track.addEventListener('pointermove', async e => {
    if (!out.duration) { tip.hidden = true; return; }
    const r = $('seek').getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const at = f * out.duration;
    tip.hidden = false;
    tip.querySelector('span').textContent = fmt(at);
    const tr = track.getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(tr.width, e.clientX - tr.left)) + 'px';
    const it = items.find(x => x.id === playingId);
    const local = !!(it && it.source !== 'stream' && !isAudio(it) && !out.audioOnly);
    tip.classList.toggle('pic', local);
    if (!local) return;
    if (scrubPath !== it.path) { scrubPath = it.path; scrub.src = await api.fileUrl(it.path); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); }
    want = at; draw();
  });
  track.addEventListener('pointerleave', () => { tip.hidden = true; });
}

// ---------- preview: live capture of the output window ----------
let previewStream = null;
let previewTimer = null;
async function startPreview() {
  clearTimeout(previewTimer);
  try {
    const id = await api.outputSourceId();
    if (!id) {
      // Player mode: nothing to capture; the video itself sits on the preview box.
      previewStream?.getTracks().forEach(tr => tr.stop()); previewStream = null; $('preview').srcObject = null;
      return;
    }
    previewStream?.getTracks().forEach(tr => tr.stop());
    previewStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 1280, maxHeight: 720, maxFrameRate: 30 } },
    });
    $('preview').srcObject = previewStream;
    previewStream.getVideoTracks()[0].onended = () => { previewTimer = setTimeout(startPreview, 1000); };
  } catch (e) {
    console.warn('preview failed', e);
    previewTimer = setTimeout(startPreview, 2000);
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
  const first = addPaths(paths)[0];
  if (!first) return;
  if (outputReady) playItem(first); else { playWhenReady = first; selectedId = first.id; renderList(); }
}
api.onOpenFiles(openFiles);

function applyOutputSettings() {
  cmd('blackOnEnd', { on: $('blackOnEnd').checked });
  cmd('volume', { v: settings.volume ?? 1 });
  cmd('mute', { m: !!settings.muted });
  cmd('aspect', { mode: aspect });
  cmd('fade', { sec: settings.fadeSec ?? 1 });
  applyStandby(); // features.js
  if (settings.sinkId) cmd('sink', { id: settings.sinkId });
}

// ---------- audio output ----------
async function loadSinks() {
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
    sinks = devs.map((d, i) => ({ id: d.deviceId, label: d.label || t('audioDevice', { n: i + 1 }) }));
    renderChips();
  } catch (e) { console.warn(e); }
}
navigator.mediaDevices.addEventListener('devicechange', loadSinks);

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

$('loopChk').addEventListener('change', e => cmd('loop', { on: e.target.checked }));
$('autoNext').addEventListener('change', e => api.setSetting('autoNext', e.target.checked));
$('blackOnEnd').addEventListener('change', e => { api.setSetting('blackOnEnd', e.target.checked); cmd('blackOnEnd', { on: e.target.checked }); });

$('addFilesBtn').onclick = async () => addPaths(await api.pickFiles(t('pickTitle')));
$('folderBtn').onclick = () => api.openVideosFolder();

// ---------- YouTube ----------
async function addStream(url, { play = false } = {}) {
  const existing = items.find(x => x.url === url);
  if (existing) {
    addToActiveList([existing.id]); selectedId = existing.id; renderList();
    if (play) playItem(existing); else toast(t('alreadyInList'));
    return existing;
  }
  const it = { id: uid(), source: 'stream', url, path: url, title: url, loading: true };
  items.push(it); selectedId = it.id; addToActiveList([it.id]); renderList();
  const r = await api.resolveStream(url);
  it.loading = false;
  if (!r.ok) {
    items = items.filter(x => x !== it); forgetInLists(it.id); renderList();
    toast(r.error === 'LIVE' ? t('liveNotSupported') : t('streamFailed', { e: r.error }));
    return null;
  }
  it.title = r.title; it.duration = r.duration;
  save(); renderList();
  if (r.thumbnail) api.thumbFetch(it.id, r.thumbnail).then(u => { if (u) { it.thumbUrl = u; renderList(); } });
  if (play) playItem(it);
  return it;
}

// kind: 'video' or 'mp3'. replaceId turns a stream item into the downloaded file in place;
// afterId puts the new file right after an item (an MP3 next to its video).
function startDownload(url, kind, { replaceId, afterId, title, then } = {}) {
  const id = uid();
  downloads.set(id, { url, kind, replaceId, afterId, then, title: title || url, status: 'starting', percent: 0 });
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
function downloadMenu(anchor, getUrl) {
  const r = anchor.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, [
    { label: t('downloadVideoOpt'), icon: 'i-download', action: () => { const url = getUrl(); if (url) startDownload(url, 'video'); } },
    { label: t('downloadMp3Opt'), icon: 'i-music', action: () => { const url = getUrl(); if (url) startDownload(url, 'mp3'); } },
  ]);
}
$('downloadBtn').addEventListener('click', e => {
  e.preventDefault();
  if (!/^https?:\/\//i.test($('ytUrl').value.trim())) { toast(t('invalidLink')); return; }
  downloadMenu(e.currentTarget, takeLink);
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
      // Same item, now a file: it keeps its id, its place in lists, thumbnail and settings.
      const old = items[at];
      items[at] = { ...old, ...file, id: old.id };
      delete items[at].loading;
    } else if (!items.some(x => x.path.toLowerCase() === d.path.toLowerCase())) {
      const added = { ...file, id: uid() };
      items.splice(at >= 0 ? at + 1 : items.length, 0, added);
      addToActiveList([added.id], cur.afterId);
    }
    save(); renderList(); probeDurations();
    // "Remove vocals" on an online video downloads it first, then carries on here.
    if (cur.then === 'vocals') { const it = items.find(x => x.id === cur.replaceId) || items.find(x => x.path === d.path); if (it) removeVocals(it); }
  }
  if (d.status === 'canceled') downloads.delete(d.id);
  renderDownloads();
  if (cur.then === 'all') renderCheck?.(); // features.js: "Download all" in the list check
});

// yt-dlp (~17 MB, first YouTube use) and FFmpeg (~28 MB, first MP3) download on demand: shown as
// a row with the downloads, not as a toast.
const toolSetup = new Map(); // tool -> fraction
api.onToolSetup(({ tool, progress }) => {
  if (progress >= 1) toolSetup.delete(tool); else toolSetup.set(tool, progress);
  renderDownloads();
});

function renderDownloads() {
  pushRemote();
  const box = $('downloads');
  box.innerHTML = '';
  for (const [tool, p] of toolSetup) {
    const keys = { ffmpeg: 'mp3Setup', engine: 'engineSetup', model: 'modelSetup' };
    const el = document.createElement('div');
    el.className = 'dl';
    el.innerHTML = `<div class="dl-top"><svg class="mic-ico"><use href="#i-gear"/></svg><span class="dl-title">${escapeHtml(t(keys[tool] || 'ytSetup', { n: Math.round(p * 100) }))}</span></div>
      <div class="bar"><i style="width:${Math.round(p * 100)}%"></i></div>`;
    box.appendChild(el);
  }
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
// One media-key press can arrive twice (system-wide shortcut + the projector's media session); act once.
let lastMediaKeyAt = 0;
function handleKey(k) {
  if (k.code.startsWith('Media')) {
    const now = performance.now();
    if (now - lastMediaKeyAt < 400) return true;
    lastMediaKeyAt = now;
  }
  const vol = out.muted ? 0 : out.volume;
  switch (k.code) {
    case 'Space': case 'KeyK': togglePlay(); break;
    // Keyboard media keys, routed here by the projector window's media session.
    case 'MediaPlayPause': togglePlay(); break;
    case 'MediaPlay': if (!out.loaded || out.paused) togglePlay(); break;
    case 'MediaPause': if (out.loaded && !out.paused) cmd('pause'); break;
    case 'MediaStop': cmd('stop'); break;
    case 'MediaTrackNext': nextItem(); break;
    case 'MediaTrackPrevious': prevItem(); break;
    case 'ArrowRight': cmd('seekBy', { d: k.shift ? 30 : 5 }); break;
    case 'ArrowLeft': cmd('seekBy', { d: k.shift ? -30 : -5 }); break;
    case 'KeyL': cmd('seekBy', { d: 10 }); break;
    case 'KeyJ': cmd('seekBy', { d: -10 }); break;
    case 'ArrowUp': setVolume(vol + 0.05); break;
    case 'ArrowDown': setVolume(vol - 0.05); break;
    case 'KeyM': toggleMute(); break;
    case 'KeyB': case 'Period': cmd('black', { on: !out.black }); break;
    case 'KeyN': if (k.shift) stepLyric(1); else nextItem(); break;
    case 'KeyP': if (k.shift) stepLyric(-1); else prevItem(); break;
    case 'PageDown': nextItem(); break;
    case 'PageUp': prevItem(); break;
    case 'KeyA': setAspect(ASPECTS[(ASPECTS.indexOf(aspect) + 1) % ASPECTS.length]); break;
    case 'KeyC': if (out.subs) setSubsOn(!out.subsOn); break;
    case 'KeyT': showCountdown(); break;
    case 'KeyI': setTrimHere('start'); break;
    case 'KeyO': setTrimHere('end'); break;
    case 'Home': cmd('seek', { t: out.trim?.start || 0 }); break;
    case 'End': if (out.duration) cmd('seek', { t: (out.trim?.end || out.duration) - 0.1 }); break;
    case 'KeyF': case 'DblClick': if (modeState.mode === 'player') api.playerFullscreen(!modeState.fullscreen); break;
    case 'Escape':
      // Leave full screen; or, when the video also covers this screen, give the screen back.
      if (modeState.fullscreen) api.playerFullscreen(false);
      else if (modeState.showOn.here) setShowOn(modeState.showOn.screens, false);
      else if (out.lyrics) hideLyrics();
      else return false;
      break;
    case 'KeyZ': cmd('freeze', { on: !out.frozen }); break;
    case 'BracketLeft': cmd('frame', { n: -1 }); break;
    case 'BracketRight': cmd('frame', { n: 1 }); break;
    case 'Enter': case 'NumpadEnter': playItem(items.find(x => x.id === selectedId)); break;
    case 'Delete': if (selectedId) removeItem(selectedId); break;
    case 'Slash': if (k.shift) showShortcuts(); else return false; break;
    default: {
      const m = /^(?:Digit|Numpad)(\d)$/.exec(k.code);
      if (m && out.duration) { cmd('seek', { t: out.duration * Number(m[1]) / 10 }); return true; }
      return false;
    }
  }
  return true;
}
function moveSelection(delta) {
  const view = viewItems();
  if (!view.length) return;
  const i = view.findIndex(x => x.id === selectedId);
  const n = Math.max(0, Math.min(view.length - 1, (i < 0 ? (delta > 0 ? -1 : view.length) : i) + delta));
  selectedId = view[n].id; renderList();
  document.querySelector('.item.selected')?.scrollIntoView({ block: 'nearest' });
}

window.addEventListener('keydown', e => {
  const menu = document.getElementById('menu');
  if (menu) {
    const buttons = [...menu.querySelectorAll('button')];
    const i = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') closeMenu();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    else if (e.key === 'Enter' && i >= 0) buttons[i].click();
    e.preventDefault();
    return;
  }
  if (!$('modal').hidden) return; // dialogs handle their own keys
  const tag = e.target.tagName;
  if (e.code.startsWith('Media')) return; // handled once, through the media session (see output.html)
  if ((tag === 'INPUT' && !['range', 'checkbox'].includes(e.target.type)) || tag === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return; }
  if (tag === 'SELECT') return;
  if (e.ctrlKey || e.altKey || e.metaKey) {
    if (e.ctrlKey && e.code === 'KeyO') { e.preventDefault(); $('addFilesBtn').click(); }
    if (e.ctrlKey && e.code === 'KeyB') { e.preventDefault(); toggleSide(); }
    if (e.ctrlKey && e.code === 'KeyF') { e.preventDefault(); openSearch(); }
    if (e.ctrlKey && e.code === 'KeyM') { e.preventDefault(); toggleMini(); }
    if (e.ctrlKey && e.code === 'Comma') { e.preventDefault(); showSettings(); }
    if (e.ctrlKey && e.code === 'KeyD') { e.preventDefault(); addMark(); }
    if (e.altKey && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) { e.preventDefault(); stepMark(e.code === 'ArrowRight' ? 1 : -1); }
    return;
  }
  // Up/Down with Shift moves the playlist selection; plain Up/Down is volume.
  if (e.shiftKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { e.preventDefault(); moveSelection(e.code === 'ArrowUp' ? -1 : 1); return; }
  if (handleKey({ code: e.code, shift: e.shiftKey })) e.preventDefault();
});
api.onOutputKey(k => handleKey(k));
// A focused button would also "click" on Space/Enter, toggling twice. Shortcuts own those keys.
window.addEventListener('keyup', e => { if (e.target.tagName === 'BUTTON' && $('modal').hidden && (e.code === 'Space' || e.code === 'Enter')) e.preventDefault(); });
// Mouse clicks shouldn't leave buttons focused.
document.addEventListener('click', e => { if (e.detail > 0 && $('modal').hidden) e.target.closest('button')?.blur(); });

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

// ---------- phone remote: the state the phone shows ----------
let remoteTimer = null;
function pushRemote() {
  if (remoteTimer) return;
  remoteTimer = setTimeout(() => {
    remoteTimer = null;
    const it = items.find(x => x.id === playingId);
    const slides = out.loaded ? lyricSlides(it) : [];
    const state = {
      lang: LANG, appName: t('appName'),
      title: out.loaded && it ? it.title : '', next: nextUp()?.title || '',
      loaded: out.loaded, paused: out.paused, buffering: out.buffering, time: out.time, duration: out.duration, rate: out.rate,
      black: !!out.black && !out.audioOnly, frozen: !!out.frozen, volume: out.volume, muted: out.muted,
      playingId, listName: activeList()?.name || '',
      items: viewItems().map(x => ({ id: x.id, title: x.title, duration: x.duration || 0, missing: !!x.missing, loading: !!x.loading, online: x.source === 'stream', thumb: x.thumbUrl ? (x.thumbUrl.split('?v=')[1] || '1') : '' })),
      lyrics: slides.length ? { slides, current: out.lyrics ? currentLyric : -1 } : null,
      marks: out.loaded && it?.marks?.length ? { list: it.marks.map(m => ({ t: m.t, label: m.label })), current: currentMark(it.marks) } : null,
      // Lists, downloads, the countdown, karaoke and the playback options, for the phone app.
      lists: lists.map(l => ({ id: l.id, name: l.name, count: l.itemIds.length })), activeList: activeList()?.id || null,
      downloads: [...downloads].map(([id, d]) => ({ id, title: d.title, kind: d.kind, status: d.status, percent: Math.round(d.percent || 0), error: d.error || '' })),
      countdown: out.countdown ? out.countdown.until : 0,
      karaoke: (() => { const k = karaokeState(); return { kind: k.kind, on: !!k.it?.stemsOn, progress: k.job ? Math.round((k.job.progress || 0) * 100) : null }; })(),
      speed: rate, subs: !!out.subs, subsOn: !!out.subsOn, autoNext: $('autoNext').checked, loop: $('loopChk').checked,
    };
    api.remoteState(state);     // the Wi-Fi page (remote.js)
    LinkHost.broadcast(state);  // the phone app (link-host.js)
  }, 200);
}

// ---------- init ----------
async function init() {
  settings = await api.getSettings();
  $('autoNext').checked = !!settings.autoNext;
  $('blackOnEnd').checked = settings.blackOnEnd ?? true;
  items = (await api.loadPlaylist()).map(({ loading, ...it }) => it);
  await loadLists(); // features.js
  initRemote(); // features.js
  applySide();
  setLang(settings.lang || 'en');
  renderVolume(settings.volume ?? 1, !!settings.muted);
  probeDurations();
  api.getDisplays();
  outputReady = await api.outputIsReady();
  startPreview();
  applyOutputSettings();
  openFiles(await api.takeOpenFiles());
  const link = await api.takeOpenLink();
  if (link) openLink(link); // features.js
  if (!settings.onboarded && !settings._selftest) showOnboarding(); // features.js
}
window.addEventListener('DOMContentLoaded', init);

// ---------- quick tooltips ----------
// Buttons show their label right away on hover. The text lives in data-tip so the slow native
// tooltip doesn't show as well; translations still set title, which is moved over on hover.
{
  const tip = document.createElement('div');
  tip.className = 'tip';
  document.body.appendChild(tip);
  let target = null, timer;
  const hide = () => { clearTimeout(timer); tip.classList.remove('show'); target = null; };
  document.addEventListener('pointerover', e => {
    const el = e.target.closest('button[title], label[title], button[data-tip], label[data-tip], .status-pill');
    if (el === target) return;
    hide();
    if (!el || el.closest('.menu, .modal')) return;
    if (el.title) { el.dataset.tip = el.title; el.removeAttribute('title'); }
    if (!el.dataset.tip) return;
    target = el;
    timer = setTimeout(() => {
      tip.textContent = el.dataset.tip;
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      const below = r.bottom + 8 + h < innerHeight;
      tip.style.left = Math.max(6, Math.min(innerWidth - w - 6, r.left + r.width / 2 - w / 2)) + 'px';
      tip.style.top = (below ? r.bottom + 8 : r.top - h - 8) + 'px';
      tip.classList.add('show');
    }, 250);
  });
  document.addEventListener('pointerdown', hide);
  window.addEventListener('blur', hide);
}
