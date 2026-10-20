// Optional updates from GitHub Releases.
//
// The app checks the latest release quietly; if it's newer, the control window shows an "Update"
// button. Nothing happens until the operator presses it (never in the middle of a presentation).
// The installer is downloaded, checked against the SHA-256 that GitHub publishes for the file,
// run silently, and the app restarts on the new version. The portable build can't replace itself,
// so for it the button opens the release page instead.
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'michaelsaad/ma3madan-video-presenter';
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
const currentVersion = () => process.env.VP_FAKE_VERSION || app.getVersion();

let latest = null; // { version, notes, page, asset: { name, url, size, sha256 }, canInstall }

function isNewer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function check() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Ma3madan-Play' },
  });
  if (!res.ok) return null;
  const release = await res.json();
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !isNewer(version, currentVersion())) return null;
  const setup = (release.assets || []).find(a => /-Setup-[\d.]+\.exe$/.test(a.name));
  const sha256 = setup?.digest?.startsWith('sha256:') ? setup.digest.slice(7) : null;
  latest = {
    version,
    notes: release.body || '',
    page: release.html_url,
    asset: setup && { name: setup.name, url: setup.browser_download_url, size: setup.size, sha256 },
    canInstall: !isPortable && !!sha256 && (app.isPackaged || !!process.env.VP_UPDATE_DRYRUN),
  };
  return { version, notes: latest.notes, canInstall: latest.canInstall };
}

// onProgress(fraction) while downloading. Resolves 'opened' (release page), 'verified' (dry run),
// or never (the app quits so the installer can replace it).
async function install(onProgress) {
  if (!latest) throw new Error('No update available');
  if (!latest.canInstall) { shell.openExternal(latest.page); return 'opened'; }

  const { name, url, size, sha256 } = latest.asset;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma3madan-update-'));
  const file = path.join(dir, name);
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  let received = 0, lastPct = -1;
  for await (const chunk of res.body) {
    hash.update(chunk);
    received += chunk.length;
    if (!out.write(chunk)) await new Promise(ok => out.once('drain', ok));
    const pct = Math.floor((received / (size || received)) * 100);
    if (pct !== lastPct) { lastPct = pct; onProgress(pct / 100); }
  }
  await new Promise((ok, fail) => out.end(err => (err ? fail(err) : ok())));
  if (hash.digest('hex') !== sha256) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('The update failed its checksum check');
  }
  if (process.env.VP_UPDATE_DRYRUN) return 'verified';

  // Silent install over the current one, then start the new version.
  spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
  return new Promise(() => {});
}

module.exports = { check, install };
