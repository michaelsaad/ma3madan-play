// Quick check: VP_UI_ONLY=1 npm test
module.exports = async ({ js, log, wait, getOutputWin, setShowOn }) => {
  const fs = require('fs'), path = require('path');
  const media = path.join(__dirname, 'media');
  await js(`addPaths(${JSON.stringify(fs.readdirSync(media).map(f => path.join(media, f)))})`); await wait(1500);
  const screens = JSON.parse(await js('JSON.stringify(modeState.screens)'));
  const other = screens.find(x => !x.here);
  if (!other) { log('only one screen: skipped'); return; }
  setShowOn({ screens: [other.id], here: false }); await wait(1500);
  const tone = "items.find(x => x.title === 'tone')";
  await js(`setAudioStandby(true); playItem(${tone})`); await wait(1500);
  log('MP3, standby on → projector visible:', getOutputWin().isVisible());
  await js('setAudioStandby(false)'); await wait(800);
  log('MP3, standby off → projector visible:', getOutputWin().isVisible(), '| still playing:', await js('!out.paused'));
  await js(`playItem(items.find(x => x.title === 'sample-1'))`); await wait(2500);
  log('a video again → projector visible:', getOutputWin().isVisible());
  await js(`setAudioStandby(true)`);
};
