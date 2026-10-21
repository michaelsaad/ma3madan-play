// Main process: the control window (operator screen), the playback engine, and the IPC between them.
//
// The playback engine (output.html) lives in a WebContentsView that moves between two homes:
// - Presenter mode: a full-screen window on the second screen (the projector).
// - Player mode: inside the control window, over its preview box, like a normal video player.
// Moving the view doesn't reload it, so switching modes doesn't interrupt the video.
const { app, BrowserWindow, BaseWindow, WebContentsView, ipcMain, screen, dialog, shell, globalShortcut, nativeTheme, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const youtube = require('./youtube');
const streamProxy = require('./stream-proxy');
const updater = require('./updater');
const vocals = require('./vocals');
const remote = require('./remote');

const APP_NAME = 'Ma3madan Play';
const OLD_APP_NAME = 'Ma3madan Video Presenter'; // the name before 1.4.0

// The phone app connects straight over the Wi-Fi (WebRTC): offer this PC's real local address
// rather than a hidden ".local" name, which many church and office networks can't resolve.
// The tests also run with the screen locked or off: keep painting windows Windows thinks are hidden.
app.commandLine.appendSwitch('disable-features', ['WebRtcHideLocalIpsWithMdns', ...(process.env.VP_SELFTEST ? ['CalculateNativeWinOcclusion'] : [])].join(','));
if (process.env.VP_SELFTEST) {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
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
const listsFile = () => path.join(app.getPath('userData'), 'lists.json');
const thumbsDir = () => path.join(app.getPath('userData'), 'thumbs');
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

// ---------- screens ----------
// Screens are numbered like a map: 1 is the main screen, the others follow from left to right.
function numberedDisplays() {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter(d => d.id !== primary.id)
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return [primary, ...others].map((d, i) => ({ d, n: i + 1 }));
}
// The screen the controls are on (usually the laptop).
const controlDisplay = () => (controlWin ? screen.getDisplayMatching(controlWin.getBounds()) : screen.getPrimaryDisplay());

// "Show on": the other screens that show the video, and whether this screen shows it too.
// No other screen → Player mode: the video plays inside this window.
let showOn = null; // { screens: [display ids], here: bool }; null = automatic

function defaultShowOn() {
  const ctl = controlDisplay();
  const others = screen.getAllDisplays().filter(d => d.id !== ctl.id);
  const pick = others.find(d => d.id === settings.outputDisplayId) || others[0];
  return { screens: pick ? [pick.id] : [], here: false };
}
function liveShowOn() {
  const ctl = controlDisplay();
  const ids = new Set(screen.getAllDisplays().map(d => d.id));
  const s = showOn || defaultShowOn();
  return { screens: s.screens.filter(id => ids.has(id) && id !== ctl.id), here: !!s.here };
}
// The screen where the video engine itself plays, full screen. Other chosen screens mirror it.
function projectorDisplay() {
  const id = liveShowOn().screens[0];
  return screen.getAllDisplays().find(d => d.id === id) || null;
}

// ---------- modes ----------
function sendMode() {
  if (!controlWin) return;
  const ctl = controlDisplay();
  controlWin.webContents.send('mode', {
    mode,
    fullscreen: playerFullscreen,
    canPresent: screen.getAllDisplays().length > 1,
    showOn: liveShowOn(),
    screens: numberedDisplays().map(({ d, n }) => ({
      id: d.id, n, bounds: d.bounds, width: d.size.width, height: d.size.height, here: d.id === ctl.id,
    })),
  });
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
  if (next === mode && outputView.__home === next) return;
  mode = next;
  outputView.__home?.contentView?.removeChildView(outputView);
  if (mode === 'presenter') {
    if (playerFullscreen) { playerFullscreen = false; controlView.setVisible(true); controlWin.setFullScreen(false); }
    outputWin.contentView.addChildView(outputView);
    outputView.__home = outputWin;
  } else {
    outputWin.hide();
    controlWin.contentView.addChildView(outputView, 0); // under the page
    outputView.__home = controlWin;
    fitViewToPlayer();
  }
  outputView.webContents.send('cmd', { type: 'playerMode', on: mode === 'player' });
}

// Apply "Show on": move the engine, place the projector window, open or close the mirrors.
function applyShowOn() {
  const s = liveShowOn();
  setMode(s.screens.length ? 'presenter' : 'player');
  placeOutput();
  syncMirrors();
  sendMode();
}

// Presenter: always full screen on the projector. Never a small window on the main screen.
function placeOutput() {
  if (!outputWin || mode !== 'presenter') return;
  const d = projectorDisplay();
  if (!d) { applyShowOn(); return; }
  fullscreenOn(outputWin, d);
  if (!hiddenForAudio) outputWin.showInactive();
  fitViewToOutputWin();
}

function fullscreenOn(win, display) {
  win.setFullScreen(false);
  win.setBounds(display.bounds);
  win.setFullScreen(true);
}

// Mirrors: the other chosen screens show a live copy of the projector window. The sound plays
// once, from the engine. A mirror on this screen covers the controls; Esc takes it away again.
const mirrors = new Map(); // display id → BrowserWindow
function syncMirrors() {
  const s = liveShowOn();
  const here = controlDisplay().id;
  const want = mode === 'presenter' ? [...s.screens.slice(1), ...(s.here ? [here] : [])] : [];
  for (const [id, w] of mirrors) if (!want.includes(id)) { mirrors.delete(id); w.destroy(); }
  for (const id of want) {
    const d = screen.getAllDisplays().find(x => x.id === id);
    if (!d) continue;
    let w = mirrors.get(id);
    if (!w) {
      w = new BrowserWindow({
        show: false, frame: false, backgroundColor: '#000000', skipTaskbar: true,
        focusable: id === here, // only the one over the controls takes keys (Esc)
        title: `${APP_NAME} — Mirror`,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
      });
      w.setMenu(null);
      w.loadFile(path.join(__dirname, 'mirror.html'));
      w.on('closed', () => { if (mirrors.get(id) === w) mirrors.delete(id); });
      mirrors.set(id, w);
    }
    fullscreenOn(w, d);
    if (hiddenForAudio) w.hide();
    else if (id === here) { w.show(); w.focus(); } else w.showInactive();
  }
}

// Big screen numbers for a moment, so the operator knows which screen is which.
let identifyWins = [];
function identifyScreens() {
  for (const w of identifyWins) if (!w.isDestroyed()) w.destroy();
  identifyWins = numberedDisplays().map(({ d, n }) => {
    const size = 220;
    const w = new BrowserWindow({
      x: Math.round(d.bounds.x + (d.bounds.width - size) / 2), y: Math.round(d.bounds.y + (d.bounds.height - size) / 2),
      width: size, height: size, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, show: false, hasShadow: false,
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true);
    w.loadFile(path.join(__dirname, 'identify.html'), { query: { n: String(n) } });
    w.once('ready-to-show', () => w.showInactive());
    return w;
  });
  const wins = identifyWins;
  setTimeout(() => { for (const w of wins) if (!w.isDestroyed()) w.destroy(); }, 2500);
}

function onDisplaysChanged() {
  if (!modeChosen) showOn = null;
  applyShowOn();
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
    // A video opened from Explorer plays like a normal player; otherwise a second screen is used.
    if (pendingOpen.length && !modeChosen) showOn = { screens: [], here: false };
    mode = null;
    applyShowOn();
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
  dark: { bg: '#0a101d', bar: '#111a2b', symbol: '#e9edf5' },
  light: { bg: '#edf1f7', bar: '#ffffff', symbol: '#172033' },
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

// The control window is two layers: in Player mode the video engine at the bottom, and on top the
// page (control.html) with a transparent background where the preview box is. So the video shows
// through the box, and menus and dialogs open over it without stopping, hiding or shrinking it.
let controlView = null;
function fitControlView() {
  if (!controlWin || !controlView) return;
  const { width, height } = controlWin.getContentBounds();
  controlView.setBounds({ x: 0, y: 0, width, height });
}
function createControl() {
  applyTheme();
  const colors = themeColors();
  controlWin = new BaseWindow({
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
  });
  controlView = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  controlView.setBackgroundColor('#00000000');
  controlWin.contentView.addChildView(controlView);
  // The rest of this file talks to the page as controlWin.webContents.
  Object.defineProperty(controlWin, 'webContents', { value: controlView.webContents });
  fitControlView();
  controlWin.setMenu(null);
  if (settings.controlMaximized ?? true) controlWin.maximize();
  controlView.webContents.once('did-finish-load', () => { controlWin.show(); controlView.webContents.focus(); });
  controlView.webContents.loadFile(path.join(__dirname, 'control.html'));
  controlWin.on('focus', () => { if (!playerFullscreen) controlView.webContents.focus(); });

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
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) controlWin.on(ev, () => { if (!mini) rememberBounds(); });
  // Coming back to the app with a YouTube link copied (from WhatsApp, a browser…): offer to play it.
  controlWin.on('focus', checkClipboard);
  controlWin.on('resize', () => { fitControlView(); fitViewToPlayer(); });
  controlWin.on('maximize', fitControlView);
  controlWin.on('unmaximize', fitControlView);
  controlWin.on('enter-full-screen', () => { fitControlView(); fitViewToPlayer(); });
  controlWin.on('leave-full-screen', () => { playerFullscreen = false; controlView.setVisible(true); fitControlView(); fitViewToPlayer(); controlView.webContents.focus(); sendMode(); });
  controlWin.on('closed', () => {
    controlWin = null;
    for (const w of mirrors.values()) w.destroy();
    outputWin?.destroy();
    app.quit();
  });
}

// ---------- mini mode: a small control bar that stays on top of other programs ----------
let mini = null; // { bounds, maximized } to restore
function setMini(on) {
  if (!controlWin || !!on === !!mini) return;
  // Leaving full screen restores the old size when it finishes: wait for that, or it undoes ours.
  if (controlWin.isFullScreen()) {
    controlWin.once('leave-full-screen', () => setTimeout(() => setMini(on), 100));
    if (playerFullscreen) togglePlayerFullscreen(false); else controlWin.setFullScreen(false);
    return;
  }
  if (on) {
    mini = { bounds: controlWin.getNormalBounds(), maximized: controlWin.isMaximized() };
    if (mini.maximized) controlWin.unmaximize();
    const a = screen.getDisplayMatching(controlWin.getBounds()).workArea;
    const w = 560, h = 200;
    controlWin.setMinimumSize(420, 160);
    controlWin.setBounds({ x: a.x + a.width - w - 16, y: a.y + a.height - h - 16, width: w, height: h });
    controlWin.setAlwaysOnTop(true, 'floating');
  } else {
    const back = mini;
    mini = null;
    controlWin.setAlwaysOnTop(false);
    controlWin.setMinimumSize(640, 480);
    controlWin.setBounds(back.bounds);
    if (back.maximized) controlWin.maximize();
  }
  controlWin.webContents.send('mini', !!mini);
}

// ---------- links from outside: ma3madan:// and the clipboard ----------
// ma3madan://play?url=<link> (or ma3madan://<link>) opens a YouTube link in the app, e.g. from a
// browser bookmarklet. Copying a link and switching to the app does the same with one click.
const YT_RE = /^https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)\S+$/i;
function linkFromProtocol(arg) {
  if (!/^ma3madan:/i.test(arg || '')) return null;
  let rest = arg.replace(/^ma3madan:\/*/i, '');
  try {
    const u = new URL('ma3madan://' + rest);
    if (u.searchParams.get('url')) rest = u.searchParams.get('url');
  } catch {}
  rest = decodeURIComponent(rest).replace(/^(https?):\/*(?!\/)/i, '$1://');
  return YT_RE.test(rest) ? rest : null;
}
let pendingLink = process.argv.map(linkFromProtocol).find(Boolean) || null;
let lastClipboard = '';
function checkClipboard() {
  if (process.env.VP_SELFTEST && !process.env.VP_CLIPBOARD_TEST) return;
  if (settings.clipboardLinks === false) return;
  const text = clipboard.readText().trim();
  if (!text || text === lastClipboard) return;
  lastClipboard = text;
  if (YT_RE.test(text)) controlWin?.webContents.send('clipboard-link', text);
}

function togglePlayerFullscreen(on) {
  if (!controlWin || mode !== 'player') return;
  playerFullscreen = on ?? !playerFullscreen;
  controlView.setVisible(!playerFullscreen);
  controlWin.setFullScreen(playerFullscreen);
  fitControlView();
  fitViewToPlayer();
  if (playerFullscreen) outputView.webContents.focus(); else controlView.webContents.focus();
  sendMode();
}

// The installer registers ma3madan:// too; this keeps it pointing at the current copy (portable).
if (app.isPackaged && !process.env.VP_SELFTEST) app.setAsDefaultProtocolClient('ma3madan');

app.whenReady().then(async () => {
  await streamProxy.start();
  createControl();
  createOutput();
  registerMediaKeys();
  if (settings.remoteOn && !process.env.VP_SELFTEST) startRemote().catch(() => {});
  // yt-dlp has to keep up with YouTube's changes: update it quietly once a week.
  if (!process.env.VP_SELFTEST) {
    setTimeout(() => {
      const week = 7 * 24 * 60 * 60 * 1000;
      if (!youtube.isInstalled() || Date.now() - (settings.ytdlpCheckedAt || 0) < week) return;
      settings.ytdlpCheckedAt = Date.now(); saveSettings();
      youtube.updateYtdlp().catch(() => {});
    }, 60 * 1000);
  }
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
      setMode: m => { modeChosen = true; showOn = m === 'player' ? { screens: [], here: false } : null; applyShowOn(); },
      getMirrors: () => [...mirrors.values()],
      setShowOn: s => { modeChosen = true; showOn = s; applyShowOn(); },
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
  const link = argv.map(linkFromProtocol).find(Boolean);
  if (link) controlWin.webContents.send('open-link', link);
  const files = filesFromArgv(argv);
  if (files.length) {
    // A video opened from Explorer while the app runs: play it like a normal player.
    if (!modeChosen) { showOn = { screens: [], here: false }; applyShowOn(); }
    controlWin.webContents.send('open-files', files);
  }
});

// ---------- IPC ----------
// The control window drives the engine by sending commands; the engine reports its state back.
ipcMain.on('cmd', (_e, cmd) => outputView?.webContents.send('cmd', cmd));
let lastState = {};
ipcMain.on('state', (_e, state) => { lastState = state; controlWin?.webContents.send('state', state); audioOnlyScreens(state); });

// Sound only (an MP3, a voice note): by default the audience sees the standby screen. With
// "Standby screen for sound only" off, the projector (and mirrors) step aside instead, so whatever
// else is on those screens (slides, the desktop) stays in view. Lyrics or a countdown bring it back.
let hiddenForAudio = false;
function audioOnlyScreens(state) {
  const hide = settings.audioStandby === false && mode === 'presenter' && state.loaded && state.audioOnly && !state.lyrics && !state.countdown;
  if (hide === hiddenForAudio || !outputWin) return;
  hiddenForAudio = hide;
  if (hide) {
    outputWin.hide();
    for (const w of mirrors.values()) w.hide();
  } else {
    placeOutput();
    syncMirrors();
  }
}
ipcMain.on('output-key', (_e, key) => controlWin?.webContents.send('output-key', key));
ipcMain.handle('output-is-ready', () => outputReady);
// The live preview of the projector (Presenter mode only; in Player mode the video is right there).
ipcMain.handle('output-source-id', () => (mode === 'presenter' ? outputWin?.getMediaSourceId() ?? null : null));
ipcMain.handle('take-open-files', () => { const files = pendingOpen; pendingOpen = []; return files; });
ipcMain.handle('take-open-link', () => { const l = pendingLink; pendingLink = null; return l; });
ipcMain.handle('stream-speed', () => streamProxy.lastSpeed());
ipcMain.on('set-mini', (_e, on) => setMini(on));
ipcMain.on('clipboard-seen', (_e, text) => { lastClipboard = text; });

ipcMain.handle('get-displays', () => { sendMode(); return true; });
ipcMain.on('set-show-on', (_e, s) => {
  modeChosen = true;
  showOn = { screens: (s.screens || []).map(Number), here: !!s.here };
  if (showOn.screens[0]) { settings.outputDisplayId = showOn.screens[0]; saveSettings(); }
  applyShowOn();
});
ipcMain.on('identify-screens', () => identifyScreens());
// Freeze: the engine sends small live frames so the preview keeps showing the running video.
ipcMain.on('live-frame', (_e, frame) => controlWin?.webContents.send('live-frame', frame));
ipcMain.on('player-rect', (_e, rect) => {
  playerRect = rect && rect.width > 0 && rect.height > 0
    ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    : { x: 0, y: 0, width: 0, height: 0 };
  fitViewToPlayer();
});
ipcMain.on('player-fullscreen', (_e, on) => togglePlayerFullscreen(on));

ipcMain.handle('get-settings', () => ({ ...settings, _selftest: !!process.env.VP_SELFTEST }));
ipcMain.on('set-setting', (_e, key, value) => { settings[key] = value; saveSettings(); if (key === 'audioStandby') audioOnlyScreens(lastState); });

ipcMain.handle('playlist-load', () =>
  readJson(playlistFile(), []).map(({ stems, ...it }) => ({
    ...it,
    // Separated tracks that were deleted outside the app are simply forgotten.
    ...(stems && fs.existsSync(stems.music) && fs.existsSync(stems.vocals) ? { stems } : {}),
    missing: it.source !== 'stream' && (!fs.existsSync(it.path) || (it.audioPath && !fs.existsSync(it.audioPath))),
    thumbUrl: fs.existsSync(thumbFile(it.id)) ? pathToFileURL(thumbFile(it.id)).href : null,
  })));
ipcMain.on('playlist-save', (_e, items) => writeJson(playlistFile(), items.map(({ missing, thumbUrl, loading, ...rest }) => rest)));
ipcMain.handle('file-url', (_e, p) => pathToFileURL(p).href);

// Saved lists ("Sunday meeting"…): names and the ids of their items, which live in Recents.
ipcMain.handle('lists-load', () => readJson(listsFile(), []));
ipcMain.on('lists-save', (_e, lists) => writeJson(listsFile(), lists));

// Thumbnails: a small JPEG per item in userData/thumbs, made by the control window from a frame
// (local files) or downloaded from YouTube (streams).
const thumbFile = id => path.join(thumbsDir(), String(id).replace(/[^\w-]/g, '') + '.jpg');
ipcMain.handle('thumb-save', (_e, id, bytes) => {
  fs.mkdirSync(thumbsDir(), { recursive: true });
  fs.writeFileSync(thumbFile(id), Buffer.from(bytes));
  return pathToFileURL(thumbFile(id)).href + '?v=' + Date.now();
});
ipcMain.handle('thumb-fetch', async (_e, id, url) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)(ytimg\.com|ggpht\.com|googleusercontent\.com)$/.test(u.hostname)) return null;
    const r = await fetch(u);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2e6 || buf[0] !== 0xff || buf[1] !== 0xd8) return null; // JPEG only
    fs.mkdirSync(thumbsDir(), { recursive: true });
    fs.writeFileSync(thumbFile(id), buf);
    return pathToFileURL(thumbFile(id)).href + '?v=' + Date.now();
  } catch { return null; }
});
ipcMain.handle('thumb-url', (_e, id) => (fs.existsSync(thumbFile(id)) ? pathToFileURL(thumbFile(id)).href : null));
ipcMain.on('thumb-delete', (_e, id) => fs.rm(thumbFile(id), { force: true }, () => {}));

// Subtitles: a .srt or .vtt next to the video with the same name is found by itself.
const SUB_RE = /\.(srt|vtt)$/i;
ipcMain.handle('find-subs', (_e, videoPath) => {
  try {
    const dir = path.dirname(videoPath), base = path.basename(videoPath).replace(/\.[^.]+$/, '').toLowerCase();
    const found = fs.readdirSync(dir).filter(f => SUB_RE.test(f) && f.toLowerCase().startsWith(base + '.'));
    return found.length ? path.join(dir, found.sort((a, b) => a.length - b.length)[0]) : null;
  } catch { return null; }
});
ipcMain.handle('read-subs', (_e, p) => {
  try {
    if (!SUB_RE.test(p) || fs.statSync(p).size > 5e6) return null;
    const buf = fs.readFileSync(p);
    // UTF-8 most of the time; old Arabic .srt files are often Windows-1256.
    const utf8 = buf.toString('utf8');
    return utf8.includes('�') ? new TextDecoder('windows-1256').decode(buf) : utf8;
  } catch { return null; }
});
ipcMain.handle('pick-subs', async (_e, title) => {
  const r = await dialog.showOpenDialog(controlWin, { title, properties: ['openFile'], filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pick-image', async (_e, title) => {
  const r = await dialog.showOpenDialog(controlWin, { title, properties: ['openFile'], filters: [{ name: 'Pictures, GIFs and videos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'mp4', 'm4v', 'webm', 'mov', 'mkv'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('file-exists', (_e, p) => !!p && fs.existsSync(p));

// ---------- phone remote ----------
function startRemote() {
  return remote.start({
    port: 8790,
    key: settings.remoteKey,
    onCommand: c => controlWin?.webContents.send('remote-cmd', c),
    thumbPath: id => thumbFile(id),
  }).then(info => {
    settings.remoteKey = remote.key(); settings.remoteOn = true; saveSettings();
    return info;
  });
}
ipcMain.handle('remote-start', async () => {
  try { return { ok: true, ...(await startRemote()) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('remote-stop', () => { remote.stop(); settings.remoteOn = false; saveSettings(); return remote.info(); });
ipcMain.handle('remote-info', () => remote.info());
// A new key makes the old QR code useless (someone who shouldn't have it is locked out).
ipcMain.handle('remote-new-key', async () => {
  remote.stop();
  settings.remoteKey = null;
  try { return { ok: true, ...(await startRemote()) }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.on('remote-state', (_e, s) => remote.setState(s));
// The phone app (WebRTC, see link-host.js): its pairing QR code, and this PC's name for it.
ipcMain.handle('qr-svg', (_e, text) => (typeof text === 'string' && text.length < 600 ? remote.qrSvg(text) : null));
ipcMain.handle('host-name', () => require('os').hostname());

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
ipcMain.handle('ytdlp-update', async () => { settings.ytdlpCheckedAt = Date.now(); saveSettings(); return youtube.updateYtdlp(); });

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
