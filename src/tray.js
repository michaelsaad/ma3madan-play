// The app in the notification area (next to the clock). The window's ✕ always sends it there: it
// keeps running, so the phone remote still reaches it. Click the icon to bring it back; its menu
// is the only way to quit. The app also starts with Windows, hidden in the tray; turn that on or
// off in Task Manager → Startup apps.
//
// The same file is used by both apps (copy it: ma3madan-play/src/tray.js → ma3madan-ppt/src/tray.js).
const { app, Tray, Menu, nativeImage } = require('electron');

const T = {
  en: { open: 'Open {app}', quit: 'Quit {app}', still: '{app} keeps running here. To quit it, right-click this icon.' },
  ar: { open: 'فتح {app}', quit: 'إغلاق {app}', still: '{app} يظل يعمل هنا. لإغلاقه، اضغط على هذه الأيقونة بالزر الأيمن.' },
};

// options: { title, icon (png path), settings, save(), window: () => BaseWindow|null,
//            show(): after the window is back (put the projector back…),
//            hide(): before it hides (stop a video…) }
function createTray(options) {
  const { settings } = options;
  const t = k => (T[settings.lang] || T.en)[k].replace('{app}', options.title);
  let tray = null, quitting = false;
  // Started by Windows at sign-in: stay in the tray until opened.
  const startHidden = process.argv.includes('--hidden');

  app.on('before-quit', () => { quitting = true; });

  // Listed in Task Manager → Startup apps (Windows keeps its own on/off there, which this respects).
  if (app.isPackaged && !process.env.VP_SELFTEST && !process.env.MP_SELFTEST) {
    const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    try { app.setLoginItemSettings({ openAtLogin: true, name: options.title, path: exe, args: ['--hidden'] }); } catch {}
  }

  const menu = () => Menu.buildFromTemplate([
    { label: t('open'), click: show },
    { type: 'separator' },
    { label: t('quit'), click: quit },
  ]);
  function makeTray() {
    if (tray) return;
    tray = new Tray(nativeImage.createFromPath(options.icon).resize({ width: 32, height: 32 }));
    tray.setToolTip(options.title);
    tray.on('click', show);
    tray.on('right-click', () => tray.popUpContextMenu(menu()));
  }

  function show() {
    const w = options.window();
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.show(); w.focus();
    options.show?.();
  }
  function hide() {
    const w = options.window();
    if (!w) return;
    options.hide?.();
    w.hide();
    // Said once, so the ✕ doesn't look like it did nothing.
    if (!settings.trayNoticeShown) {
      settings.trayNoticeShown = true; options.save();
      try { tray?.displayBalloon({ title: options.title, content: t('still'), iconType: 'info' }); } catch {}
    }
  }
  function quit() { quitting = true; app.quit(); }

  // ✕ hides the window; only quitting from the tray (or an update installing, or Windows shutting
  // down) really closes it.
  function attach(win) {
    makeTray();
    win.on('close', e => {
      if (quitting) return;
      e.preventDefault();
      hide();
    });
    win.on('session-end', () => { quitting = true; });
  }

  return { attach, show, hide, quit, startHidden };
}

module.exports = { createTray };
