// Main process: the control window (operator screen), the output window (projector), and the IPC between them.
const { app, BrowserWindow, ipcMain, screen, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const youtube = require('./youtube');
const streamProxy = require('./stream-proxy');
const updater = require('./updater');
const vocals = require('./vocals');

const APP_NAME = 'Ma3madan Video Presenter';

if (process.env.VP_SELFTEST) {
  app.setPath('userData', process.env.VP_SELFTEST_DIR);
  app.setPath('videos', process.env.VP_SELFTEST_DIR);
}
if (!app.requestSingleInstanceLock()) app.quit();

let controlWin = null;
let outputWin = null;
let outputReady = false;

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
// The output goes to the saved display, else the first non-primary one, else the primary
// (as a small window, so a single-screen laptop can still be used for rehearsing).
function pickOutputDisplay() {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.find(d => d.id === settings.outputDisplayId)
    || displays.find(d => d.id !== primary.id)
    || primary;
}

function placeOutput() {
  if (!outputWin) return;
  const d = pickOutputDisplay();
  const onPrimary = d.id === screen.getPrimaryDisplay().id;
  outputWin.setFullScreen(false);
  if (onPrimary && !settings.fullscreenOnPrimary) {
    const w = Math.round(d.workArea.width * 0.45);
    const h = Math.round(w * 9 / 16);
    outputWin.setBounds({ x: d.workArea.x + d.workArea.width - w - 20, y: d.workArea.y + 20, width: w, height: h });
  } else {
    outputWin.setBounds(d.bounds);
    outputWin.setFullScreen(true);
  }
  sendDisplays();
}

function sendDisplays() {
  if (!controlWin) return;
  const primary = screen.getPrimaryDisplay();
  controlWin.webContents.send('displays', {
    current: pickOutputDisplay().id,
    fullscreen: outputWin ? outputWin.isFullScreen() : false,
    list: screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      index: i + 1,
      width: d.size.width,
      height: d.size.height,
      primary: d.id === primary.id,
    })),
  });
}

// ---------- windows ----------
function createOutput() {
  outputWin = new BrowserWindow({
    show: false,
    frame: false,
    backgroundColor: '#000000',
    title: `${APP_NAME} — Output`,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      // Local and streamed media would otherwise be cross-origin to Web Audio and play silent
      // through the gain node used for >100% volume. This window only ever loads output.html.
      webSecurity: false,
    },
  });
  outputWin.setMenu(null);
  outputWin.loadFile(path.join(__dirname, 'output.html'));
  outputWin.once('ready-to-show', () => {
    placeOutput();
    outputWin.showInactive();
    controlWin?.focus();
    outputReady = true;
    controlWin?.webContents.send('output-ready');
  });
  outputWin.on('closed', () => { outputWin = null; });
}

function createControl() {
  controlWin = new BrowserWindow({
    ...screen.getPrimaryDisplay().workArea,
    minWidth: 1000,
    minHeight: 640,
    frame: false, // the header in control.html is the title bar, with its own window buttons
    backgroundColor: '#0f1115',
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', 'app-256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  controlWin.setMenu(null);
  controlWin.maximize();
  controlWin.loadFile(path.join(__dirname, 'control.html'));
  for (const ev of ['maximize', 'unmaximize']) {
    controlWin.on(ev, () => controlWin.webContents.send('win-maximized', controlWin.isMaximized()));
  }
  controlWin.on('closed', () => {
    controlWin = null;
    outputWin?.destroy();
    app.quit();
  });
}

app.whenReady().then(async () => {
  await streamProxy.start();
  createControl();
  createOutput();
  // Look for a newer release a little after startup, then every 6 hours.
  if (!process.env.VP_SELFTEST || process.env.VP_FAKE_VERSION) {
    const checkForUpdate = () => updater.check()
      .then(info => info && controlWin?.webContents.send('update-available', info))
      .catch(() => {}); // offline or rate-limited: try again later
    setTimeout(checkForUpdate, process.env.VP_SELFTEST ? 1000 : 8000);
    setInterval(checkForUpdate, 6 * 60 * 60 * 1000);
  }
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(ev, placeOutput);
  }
  if (process.env.VP_SELFTEST) {
    require(path.join(__dirname, '..', 'test', 'selftest'))({ getControl: () => controlWin, getOutput: () => outputWin });
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

app.on('second-instance', (_e, argv) => {
  if (!controlWin) return;
  if (controlWin.isMinimized()) controlWin.restore();
  controlWin.focus();
  const files = filesFromArgv(argv);
  if (files.length) controlWin.webContents.send('open-files', files);
});

// ---------- IPC ----------
// The control window drives the output window by sending commands; the output reports its state back.
ipcMain.on('cmd', (_e, cmd) => outputWin?.webContents.send('cmd', cmd));
let outputHiddenForAudio = false;
ipcMain.on('state', (_e, state) => {
  controlWin?.webContents.send('state', state);
  // Audio needs no picture. On a single screen the output is a small window in the corner, so
  // tuck it away while audio plays. On a projector it stays up (black) so the desktop never shows.
  const singleScreen = pickOutputDisplay().id === screen.getPrimaryDisplay().id && !settings.fullscreenOnPrimary;
  const hide = !!(state.loaded && state.audioOnly) && singleScreen;
  if (outputWin && hide !== outputHiddenForAudio) {
    outputHiddenForAudio = hide;
    if (hide) outputWin.hide(); else { outputWin.showInactive(); controlWin?.focus(); }
  }
});
ipcMain.on('output-key', (_e, key) => controlWin?.webContents.send('output-key', key));
ipcMain.handle('output-is-ready', () => outputReady);
ipcMain.handle('output-source-id', () => outputWin?.getMediaSourceId() ?? null);
ipcMain.handle('take-open-files', () => { const files = pendingOpen; pendingOpen = []; return files; });

ipcMain.handle('get-displays', () => { sendDisplays(); return true; });
ipcMain.on('set-output-display', (_e, id) => {
  settings.outputDisplayId = id; saveSettings(); placeOutput();
});
ipcMain.on('toggle-output-fullscreen', () => {
  if (pickOutputDisplay().id === screen.getPrimaryDisplay().id) {
    settings.fullscreenOnPrimary = !settings.fullscreenOnPrimary; saveSettings();
  }
  placeOutput();
  controlWin?.focus();
});

ipcMain.on('win', (_e, action) => {
  if (!controlWin) return;
  if (action === 'minimize') controlWin.minimize();
  else if (action === 'maximize') controlWin.isMaximized() ? controlWin.unmaximize() : controlWin.maximize();
  else if (action === 'close') controlWin.close();
});
ipcMain.handle('win-is-maximized', () => controlWin?.isMaximized() ?? false);

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
ipcMain.handle('update-install', async () => {
  try { return { ok: true, result: await updater.install(p => controlWin?.webContents.send('update-progress', p)) }; }
  catch (e) { return { ok: false, error: e.message }; }
});
youtube.setSetupListener((tool, progress) => controlWin?.webContents.send('tool-setup', { tool, progress }));
