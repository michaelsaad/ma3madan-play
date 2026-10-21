// Auto quality on a real YouTube stream: up when fast, down when slow, up again when it recovers.
// VP_STREAM=<link> VP_STREAM_ONLY=1 npm test
module.exports = async ({ js, ojs, log, wait }) => {
  const proxy = require('../src/stream-proxy');
  const url = process.env.VP_STREAM;
  await js(`addStream(${JSON.stringify(url)}, { play: true })`);
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !(await ojs('!!current && v.currentTime > 0.5'))) await wait(300);
  log('stream started in', Date.now() - t0, 'ms');
  const snap = () => ojs(`JSON.stringify({t: +v.currentTime.toFixed(1), q: ladder[qIndex].label, stalled, ahead: +bufferedAhead(v).toFixed(1), aAhead: +bufferedAhead(a).toFixed(1), drift: +(a.currentTime - v.currentTime).toFixed(2), up: upgrade ? ladder[upgrade.i].label : '-', mbps: +(speed.bps / 1e6).toFixed(1), age: speed.age, open: speed.open, nextAhead: upgrade ? +bufferedAhead(vNext).toFixed(1) : null, nextRs: upgrade ? vNext.readyState : null, net: [v.networkState, a.networkState, vNext.networkState].join('')})`);
  const phase = async (name, secs) => { for (let i = 0; i < secs / 5; i++) { await wait(5000); log(`  ${name}:`, await snap()); } };
  await phase('fast', 45);
  proxy.setTestLimit(1.5e6);
  await js('cmd("seek", { t: 300 })');
  await phase('1.5 Mbit/s', 60);
  proxy.setTestLimit(0);
  await phase('fast again', 100);
  log('step-ups:', await ojs('JSON.stringify(upLog)'));
};
