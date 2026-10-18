// Renders build/icon.svg to the app icon PNGs: npx electron build/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ width: 512, height: 512, useContentSize: true, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;overflow:hidden;background:transparent">${svg.replace('<svg ', '<svg style="display:block" ')}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = (size, file) => fs.writeFileSync(file, img.resize({ width: size, height: size, quality: 'best' }).toPNG());
  out(512, path.join(__dirname, 'icon.png'));
  out(256, path.join(__dirname, '..', 'src', 'assets', 'app-256.png'));
  out(128, path.join(__dirname, '..', 'src', 'assets', 'app-128.png'));
  out(64, path.join(__dirname, '..', 'src', 'assets', 'app-64.png'));
  app.quit();
});
