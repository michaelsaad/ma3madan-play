// Main process: the control window (operator screen), the playback engine, and the IPC between them.
//
// The playback engine (output.html) lives in a WebContentsView that moves between two homes:
// - Presenter mode: a full-screen window on the second screen (the projector).
// - Player mode: inside the control window, over its preview box, like a normal video player.
// Moving the view doesn't reload it, so switching modes doesn't interrupt the video.
const { app, BrowserWindow, BaseWindow, WebContentsView, ipcMain, screen, dialog, shell, globalShortcut, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const youtube = require('./youtube');
const streamProxy = require('./stream-proxy');
const updater = require('./updater');
const vocals = require('./vocals');

const APP_NAME = 'Ma3madan Play';
const OLD_APP_NAME = 'Ma3madan Video Presenter'; // the name before 1.4.0

if (process.env.VP_SELFTEST) {
  app.setPath('userData', process.env.VP_SELFTEST_DIR);
  app.setPath('videos', process.env.VP_SELFTEST_DIR);
}
// Migration check in a throwaway folder (never the real profile): VP_MIGRATION_TEST=<dir>
if (process.env.VP_MIGRATION_TEST) {
  const dir = process.env.VP_MIGRATION_TEST;
  app.setPath('appData', dir);
  app.setPath('userData', path.join(dir, APP_NAME));
  app.setPath('videos', path.join(dir, 'Videos'));
}

// The app was renamed in 1.4.0. Carry the old data over once, so settings, the playlist, the MVSEP
// key and the downloaded tools all stay: the settings folder and the downloads folder are renamed,
// and the playlist's paths are updated to match. This must run before anything (such as the
// single-instance lock) creates the new folder.
function migrateFromOldName() {
  if (process.env.VP_SELFTEST) return;
  const oldData = path.join(app.getPath('appData'), OLD_APP_NAME);
  const newData = app.getPath('userData');
  if (!fs.existsSync(path.join(oldData, 'settings.json')) && !fs.existsSync(path.join(oldData, 'playlist.json'))) return;
  // A new folder without settings or a playlist is only caches: the old data wins.
  const newIsEmpty = !fs.existsSync(path.join(newData, 'settings.json')) && !fs.existsSync(path.join(newData, 'playlist.json'));
  if (!fs.existsSync(newData) || newIsEmpty) {
    try {
      if (fs.existsSync(newData)) fs.rmSync(newData, { recursive: true, force: true });
      fs.renameSync(oldData, newData);
    } catch {
      app.setPath('userData', oldData); // locked: keep using it where it is
      return;
    }
  } else {
    return; // both have data: leave everything as it is
  }
  const oldVideos = path.join(app.getPath('videos'), OLD_APP_NAME);
  const newVideos = path.join(app.getPath('videos'), APP_NAME);
  if (!fs.existsSync(newVideos) && fs.existsSync(oldVideos)) {
    try {
      fs.renameSync(oldVideos, newVideos);
      const list = path.join(newData, 'playlist.json');
      if (fs.existsSync(list)) {
        const esc = x => JSON.stringify(x).slice(1, -1);
        fs.writeFileSync(list, fs.readFileSync(list, 'utf8').split(esc(oldVideos)).join(esc(newVideos)));
      }
    } catch {}
  }
}
migrateFromOldName();
if (!app.requestSingleInstanceLock()) app.quit();
if (process.env.VP_MIGRATION_TEST) app.whenReady().then(() => app.quit());

let controlWin = null;
let outputWin = null;   // projector window (Presenter mode)
let outputView = null;  // the playback engine
let outputReady = false;
let mode = 'player';    // 'player' | 'presenter'
let modeChosen = false; // the operator picked a mode this session: don't switch on screen changes
let playerRect = null;  // where the preview box is in the control window (Player mode)
let playerFullscreen = false;

// ---------- persistence ----------
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const playlistFile = () => path.join(app.getPath('userData'), 'playlist.json');
const videosDir = () => path.join(app.getPath('videos'), APP_NAME);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const settings = readJson(settingsFile(), {});
const saveSettings = () => writeJson(settingsFile(), settings);

// ---------- displays ----------
// The projector is any screen other than the main one: the saved one if it's still connected,
// else the first. With a single screen there is no projector, and the app is a normal player.
function projectorDisplay() {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter(d => d.id !== primary.id);
  return others.find(d => d.id === settings.outputDisplayId) || others[0] || null;
}

function sendDisplays() {
  if (!controlWin) return;
  const primary = screen.getPrimaryDisplay();
  const projector = projectorDisplay();
  controlWin.webContents.send('displays', {
    current: projector?.id ?? null,
    list: screen.getAllDisplays().filter(d => d.id !== primary.id).map((d, i) => ({
      id: d.id, index: i + 2, width: d.size.width, height: d.size.height,
    })),
  });
}

// ---------- modes ----------
function sendMode() {
  controlWin?.webContents.send('mode', { mode, canPresent: !!projectorDisplay(), fullscreen: playerFullscreen });
}

function fitViewToOutputWin() {
  if (!outputWin || !outputView) return;
  const { width, height } = outputWin.getContentBounds();
  outputView.setBounds({ x: 0, y: 0, width, height });
}

function fitViewToPlayer() {
  if (!controlWin || !outputView || mode !== 'player') return;
  if (playerFullscreen) {
    const { width, height } = controlWin.getContentBounds();
    outputView.setBounds({ x: 0, y: 0, width, height });
  } else if (playerRect) {
    outputView.setBounds(playerRect);
  }
}

function setMode(next) {
  if (next === 'presenter' && !projectorDisplay()) next = 'player';
  if (!outputView || !controlWin) { mode = next; return; }
  if (next === mode && outputView.__home === next) { sendMode(); return; }
  mode = next;
  outputView.__home?.contentView?.removeChildView(outputView);
  if (mode === 'presenter') {
    if (playerFullscreen) { playerFullscreen = false; controlWin.setFullScreen(false); }
    outputWin.contentView.addChildView(outputView);
    outputView.__home = outputWin;
    placeOutput();
  } else {
    outputWin.hide();
    controlWin.contentView.addChildView(outputView);
    outputView.__home = controlWin;
    fitViewToPlayer();
  }
  outputView.webContents.send('cmd', { type: 'playerMode', on: mode === 'player' });
  sendMode();
  sendDisplays();
}

// Presenter: always full screen on the projector. Never a small window on the main screen.
function placeOutput() {
  if (!outputWin || mode !== 'presenter') return;
  const d = projectorDisplay();
  if (!d) { setMode('player'); return; }
  outputWin.setFullScreen(false);
  outputWin.setBounds(d.bounds);
  outputWin.setFullScreen(true);
  outputWin.showInactive();
  fitViewToOutputWin();
}

function onDisplaysChanged() {
  if (!modeChosen) setMode(projectorDisplay() ? 'presenter' : 'player');
  else if (mode === 'presenter' && !projectorDisplay()) setMode('player');
  else placeOutput();
  sendMode();
  sendDisplays();
}

// ---------- windows ----------
const engineWebPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  backgroundThrottling: false,
  autoplayPolicy: 'no-user-gesture-required',
  // Local and streamed media would otherwise be cross-origin to Web Audio and play silent
  // through the gain node used for >100% volume. This view only ever loads output.html.
  webSecurity: false,
};

function createOutput() {
  // The projector window: no frame, no taskbar entry, and it never takes focus, so the mouse can
  // pass over it without pulling control away from the operator's screen.
  outputWin = new BaseWindow({
    show: false, frame: false, backgroundColor: '#000000', skipTaskbar: true, focusable: false,
    title: `${APP_NAME} — Output`,
  });
  outputWin.on('resize', fitViewToOutputWin);
  outputWin.on('enter-full-screen', fitViewToOutputWin);
  outputWin.on('closed', () => { outputWin = null; });

  outputView = new WebContentsView({ webPreferences: engineWebPreferences });
  outputView.setBackgroundColor('#000000');
  outputView.webContents.loadFile(path.join(__dirname, 'output.html'));
  outputView.webContents.once('did-finish-load', () => {
    outputReady = true;
    const start = modeChosen ? mode : (pendingOpen.length || !projectorDisplay() ? 'player' : 'presenter');
    mode = null;
    setMode(start);
    controlWin?.focus();
    controlWin?.webContents.send('output-ready');
  });
}

// Size and place come back as they were; the first run opens maximized.
function initialBounds() {
  const saved = settings.controlBounds;
  const visible = saved && screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return saved.x < a.x + a.width - 80 && saved.x + saved.width > a.x + 80 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 80;
  });
  if (visible) return saved;
  const a = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1280, a.width), height = Math.min(800, a.height);
  return { x: a.x + Math.round((a.width - width) / 2), y: a.y + Math.round((a.height - height) / 2), width, height };
}

// Light/dark: follows Windows unless the operator picked one (settings.theme). The page's CSS
// follows nativeTheme by itself; the native title-bar buttons are told their colours here.
const THEME_COLORS = {
  dark: { bg: '#0f1115', bar: '#171a21', symbol: '#e8eaef' },
  light: { bg: '#eef0f4', bar: '#ffffff', symbol: '#1b1f27' },
};
const themeColors = () => THEME_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'];
function applyTheme() {
  nativeTheme.themeSource = ['light', 'dark'].includes(settings.theme) ? settings.theme : 'system';
}
nativeTheme.on('updated', () => {
  if (!controlWin || controlWin.isDestroyed()) return;
  const c = themeColors();
  controlWin.setTitleBarOverlay({ color: c.bar, symbolColor: c.symbol, height: 56 });
  controlWin.setBackgroundColor(c.bg);
});
ipcMain.on('set-theme', (_e, theme) => { settings.theme = theme; saveSettings(); applyTheme(); });

function createControl() {
  applyTheme();
  const colors = themeColors();
  controlWin = new BrowserWindow({
    ...initialBounds(),
    minWidth: 640,
    minHeight: 480,
    // The header in control.html is the title bar; Windows draws its own minimize/maximize/close
    // buttons on top of it, so Snap Layouts, the system menu and the animations all work.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.bar, symbolColor: colors.symbol, height: 56 },
    backgroundColor: colors.bg,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'app-256.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  controlWin.setMenu(null);
  if (settings.controlMaximized ?? true) controlWin.maximize();
  controlWin.once('ready-to-show', () => controlWin.show());
  controlWin.loadFile(path.join(__dirname, 'control.html'));

  let saveTimer;
  const rememberBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!controlWin || controlWin.isFullScreen()) return;
      settings.controlMaximized = controlWin.isMaximized();
      if (!controlWin.isMaximized() && !controlWin.isMinimized()) settings.controlBounds = controlWin.getNormalBounds();
      saveSettings();
    }, 400);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) controlWin.on(ev, rememberBounds);
  controlWin.on('resize', fitViewToPlayer);
  controlWin.on('leave-full-screen', () => { playerFullscreen = false; fitViewToPlayer(); sendMode(); });
  controlWin.on('closed', () => {
    controlWin = null;
    outputWin?.destroy();
    app.quit();
  });
}

function togglePlayerFullscreen(on) {
  if (!controlWin || mode !== 'player') return;
  playerFullscreen = on ?? !playerFullscreen;
  controlWin.setFullScreen(playerFullscreen);
  fitViewToPlayer();
  sendMode();
}

app.whenReady().then(async () => {
  await streamProxy.start();
  createControl();
  createOutput();
  registerMediaKeys();
  // Look for a newer release a little after startup, then every 6 hours.
  if (!process.env.VP_SELFTEST || process.env.VP_FAKE_VERSION) {
    const checkForUpdate = () => updater.check()
      .then(info => info && controlWin?.webContents.send('update-available', info))
      .catch(() => {}); // offline or rate-limited: try again later
    setTimeout(checkForUpdate, process.env.VP_SELFTEST ? 1000 : 8000);
    setInterval(checkForUpdate, 6 * 60 * 60 * 1000);
  }
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, onDisplaysChanged);
  }
  if (process.env.VP_SELFTEST) {
    require(path.join(__dirname, '..', 'test', 'selftest'))({
      getControl: () => controlWin,
      getOutput: () => outputView,
      getOutputWin: () => outputWin,
      getMode: () => ({ mode, playerFullscreen, playerRect, viewBounds: outputView?.getBounds(), home: outputView?.__home === controlWin ? 'control' : 'projector' }),
      setMode: m => { modeChosen = true; setMode(m); },
    });
  }
});

// ---------- files opened from Explorer ("Open with", or as the default video player) ----------
const MEDIA_RE = /\.(mp4|m4v|mkv|webm|mov|mp3|m4a|wav|aac|ogg|oga|opus|flac|weba)$/i;
function filesFromArgv(argv) {
  return argv.slice(1)
    .filter(a => !a.startsWith('-') && MEDIA_RE.test(a))
    .map(a => path.resolve(a))
    .filter(a => fs.existsSync(a));
}
let pendingOpen = filesFromArgv(process.argv);

// Keyboard media keys belong to the presenter while it's open, even when another window is in
// front or a browser is playing. (The engine's media session also routes them; the control
// window's handlers are written so a press arriving both ways still acts once.)
const MEDIA_KEYS = { MediaPlayPause: 'MediaPlayPause', MediaNextTrack: 'MediaTrackNext', MediaPreviousTrack: 'MediaTrackPrevious', MediaStop: 'MediaStop' };
function registerMediaKeys() {
  for (const [accelerator, code] of Object.entries(MEDIA_KEYS)) {
    globalShortcut.register(accelerator, () => controlWin?.webContents.send('output-key', { code }));
  }
}
app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('second-instance', (_e, argv) => {
  if (!controlWin) return;
  if (controlWin.isMinimized()) controlWin.restore();
  controlWin.focus();
  const files = filesFromArgv(argv);
  if (files.length) {
    // A video opened from Explorer while the app runs: play it like a normal player.
    if (!modeChosen) setMode('player');
    controlWin.webContents.send('open-files', files);
  }
});

// ---------- IPC ----------
// The control window drives the engine by sending commands; the engine reports its state back.
ipcMain.on('cmd', (_e, cmd) => outputView?.webContents.send('cmd', cmd));
ipcMain.on('state', (_e, state) => controlWin?.webContents.send('state', state));
ipcMain.on('output-key', (_e, key) => controlWin?.webContents.send('output-key', key));
ipcMain.handle('output-is-ready', () => outputReady);
// The live preview of the projector (Presenter mode only; in Player mode the video is right there).
ipcMain.handle('output-source-id', () => (mode === 'presenter' ? outputWin?.getMediaSourceId() ?? null : null));
ipcMain.handle('take-open-files', () => { const files = pendingOpen; pendingOpen = []; return files; });

ipcMain.handle('get-displays', () => { sendDisplays(); sendMode(); return true; });
ipcMain.on('set-output-display', (_e, id) => {
  settings.outputDisplayId = id; saveSettings(); placeOutput(); sendDisplays();
});
ipcMain.on('set-mode', (_e, m) => { modeChosen = true; setMode(m); });
ipcMain.on('player-rect', (_e, rect) => {
  playerRect = rect && rect.width > 0 && rect.height > 0
    ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    : { x: 0, y: 0, width: 0, height: 0 };
  fitViewToPlayer();
});
ipcMain.on('player-fullscreen', (_e, on) => togglePlayerFullscreen(on));

ipcMain.handle('get-settings', () => settings);
ipcMain.on('set-setting', (_e, key, value) => { settings[key] = value; saveSettings(); });

ipcMain.handle('playlist-load', () =>
  readJson(playlistFile(), []).map(({ stems, ...it }) => ({
    ...it,
    // Separated tracks that were deleted outside the app are simply forgotten.
    ...(stems && fs.existsSync(stems.music) && fs.existsSync(stems.vocals) ? { stems } : {}),
    missing: it.source !== 'stream' && (!fs.existsSync(it.path) || (it.audioPath && !fs.existsSync(it.audioPath))),
  })));
ipcMain.on('playlist-save', (_e, items) => writeJson(playlistFile(), items.map(({ missing, ...rest }) => rest)));
ipcMain.handle('file-url', (_e, p) => pathToFileURL(p).href);

ipcMain.handle('pick-files', async (_e, title) => {
  const r = await dialog.showOpenDialog(controlWin, {
    title,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video and audio', extensions: ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.on('open-videos-folder', () => {
  fs.mkdirSync(videosDir(), { recursive: true });
  shell.openPath(videosDir());
});
ipcMain.on('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.on('open-external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

// YouTube
ipcMain.on('download-start', (_e, { id, url, kind }) =>
  youtube.download(id, url, videosDir(), kind, data => controlWin?.webContents.send('download', { id, ...data })));
ipcMain.on('download-cancel', (_e, id) => youtube.cancelDownload(id));
ipcMain.handle('stream-resolve', async (_e, url, force) => {
  try { return { ok: true, ...(await youtube.resolveStream(url, force)) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('ytdlp-update', () => youtube.updateYtdlp());

// Vocal remover
vocals.setSetupListener((tool, progress) => controlWin?.webContents.send('tool-setup', { tool, progress }));
ipcMain.on('vocals-start', (_e, job) =>
  vocals.start({ ...job, outDir: videosDir() },
    ev => controlWin?.webContents.send('vocals-event', { id: job.id, ...ev }),
    settings, (k, v) => { settings[k] = v; saveSettings(); }));
ipcMain.on('vocals-cancel', (_e, id) => vocals.cancel(id));
ipcMain.handle('vocals-save-mix', async (_e, { music, vocals: voc, gains, title, dialogTitle }) => {
  const safe = (title || 'mix').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
  fs.mkdirSync(videosDir(), { recursive: true });
  const r = await dialog.showSaveDialog(controlWin, {
    title: dialogTitle,
    defaultPath: path.join(videosDir(), `${safe}.mp3`),
    filters: [{ name: 'MP3', extensions: ['mp3'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { return { ok: true, path: await vocals.saveMix({ music, vocals: voc, gains, dest: r.filePath }) }; }
  catch (e) { return { ok: false, error: e.message }; }
});

// App updates
ipcMain.handle('app-version', () => app.getVersion());
// Manual "Check for updates" from the About window: null when this is the latest.
ipcMain.handle('update-check', async () => {
  try { const info = await updater.check(); if (info) controlWin?.webContents.send('update-available', info); return { ok: true, info }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('update-install', async () => {
  try { return { ok: true, result: await updater.install(p => controlWin?.webContents.send('update-progress', p)) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
youtube.setSetupListener((tool, progress) => controlWin?.webContents.send('tool-setup', { tool, progress }));
