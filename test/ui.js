// Quick look at one dialog: VP_UI_ONLY=1 npm test (screenshots only, no long checks).
const fs = require('fs');
module.exports = async ({ js, log, wait, shot }) => {
  const notes = fs.readFileSync(process.env.VP_UI_NOTES || '', 'utf8');
  await js(`update = { version: '2.5.0', notes: ${JSON.stringify(notes)}, canInstall: true }; renderUpdate(); $('updateBtn').click()`);
  await wait(600);
  log('update button tip:', await js(`$('updateBtn').title || $('updateBtn').dataset.tip`));
  log('dialog:', await js(`$('updBox') ? $('updBox').innerText.slice(0, 200) : 'none'`));
  await shot('60-update-dialog');
  await js(`setLang('ar'); closeModal(); $('updateBtn').click()`); await wait(600);
  await shot('61-update-dialog-ar');
  await js(`closeModal(); setLang('en')`);
};
