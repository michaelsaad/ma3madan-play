// Standby "Off": the projector window steps aside entirely (the desktop or slides show through)
// whenever the standby screen would show. Run with VP_STANDBY_OFF=1 VP_FAKE_PROJECTOR=1, which
// treats the main screen as the projector so Presenter mode works on a one-screen PC.
module.exports = async ({ js, log, wait, getMode, getOutputWin, screensChanged }) => {
  const visible = () => getOutputWin().isVisible();
  log('mode:', getMode().mode, '| projector visible with standby Black and nothing playing:', visible());

  await js(`settings.standby = { kind: 'off' }; api.setSetting('standby', settings.standby); applyStandby()`);
  await wait(800);
  log('Off, nothing playing → projector visible:', visible());

  // A screen change (or picking screens) places the projector again: it must stay hidden.
  screensChanged(); await wait(800);
  log('after a screen change → visible:', visible());

  await js('playItem(items[0])'); await wait(2500);
  log('playing a video → visible:', visible());

  await js(`cmd('black', { on: true })`); await wait(2500);
  log('B (standby) while playing → visible:', visible());

  await js(`cmd('black', { on: false })`); await wait(1200);
  log('B again → visible:', visible());

  await js(`cmd('stop')`); await wait(2500);
  log('stop → visible:', visible());

  await js(`settings.standby = { kind: 'black' }; api.setSetting('standby', settings.standby); applyStandby()`);
  await wait(800);
  log('back to Black → visible:', visible());
};
