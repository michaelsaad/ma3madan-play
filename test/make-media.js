// Generates the short test clips used by selftest.js (needs the ffmpeg-static dev dependency).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('ffmpeg-static');

const dir = path.join(__dirname, 'media');
fs.mkdirSync(dir, { recursive: true });
const clip = (name, video, seconds, freq) => execFileSync(ffmpeg, [
  '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', `${video}=size=1280x720:rate=30:duration=${seconds}`,
  '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${seconds}`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
  path.join(dir, name),
]);
clip('sample-1.mp4', 'testsrc2', 20, 440);
clip('عينة 2.mp4', 'smptebars', 8, 660); // non-Latin name on purpose
console.log('test clips written to', dir);
