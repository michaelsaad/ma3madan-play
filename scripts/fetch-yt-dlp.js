// Downloads the latest official yt-dlp.exe into bin/ (bundled into the installer by electron-builder).
const fs = require('fs');
const path = require('path');

const URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const target = path.join(__dirname, '..', 'bin', 'yt-dlp.exe');

(async () => {
  if (fs.existsSync(target) && !process.argv.includes('--force')) {
    console.log('bin/yt-dlp.exe already present (use --force to refresh)');
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log('saved', target);
})().catch(e => { console.error(e.message); process.exit(1); });
