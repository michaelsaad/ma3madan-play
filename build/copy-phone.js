// npm run phone: copies the phone app (Ma3madan Remote, ../ma3madan-remote) into src/phone/ for the
// Wi-Fi page (src/lan.js), and its link.js into src/. Run it after the phone app changes.
const fs = require('fs');
const path = require('path');

const from = path.join(__dirname, '..', '..', 'ma3madan-remote', 'public');
const to = path.join(__dirname, '..', 'src', 'phone');
if (!fs.existsSync(from)) { console.error('Not found:', from); process.exit(1); }
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(path.join(to, 'icons'), { recursive: true });
for (const f of ['index.html', 'app.js', 'link.js', 'manifest.webmanifest']) fs.copyFileSync(path.join(from, f), path.join(to, f));
for (const f of fs.readdirSync(path.join(from, 'icons'))) if (/\.png$/.test(f)) fs.copyFileSync(path.join(from, 'icons', f), path.join(to, 'icons', f));
fs.copyFileSync(path.join(from, 'link.js'), path.join(__dirname, '..', 'src', 'link.js'));
console.log('phone app copied to', to);
