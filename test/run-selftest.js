// Runs the app in self-test mode and prints the log. Optional env: VP_YT (download a link), VP_STREAM (stream a link).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const media = path.join(__dirname, 'media');
if (!fs.existsSync(media)) require('./make-media');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-selftest-'));
const electron = require('electron');
spawnSync(electron, [path.join(__dirname, '..')], { stdio: 'inherit', env: { ...process.env, VP_SELFTEST: '1', VP_SELFTEST_DIR: dir } });
const log = path.join(dir, 'log.txt');
console.log(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : 'no log written');
console.log('screenshots in', dir);
process.exit(fs.existsSync(log) && /DONE/.test(fs.readFileSync(log, 'utf8')) && !/FAIL/.test(fs.readFileSync(log, 'utf8')) ? 0 : 1);
