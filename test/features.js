// Checks for lists, start/end points, fades, standby, countdown, lyrics, subtitles, resume, the list
// check, dialogs, the phone remote, mini mode and copied links. Run from selftest.js (VP_FEATURES=1
// runs only these).
const fs = require('fs');
const path = require('path');

module.exports = async ({ js, ojs, log, wait, shot, dir, getControl, getMode, getOutput }) => {
  const st = () => js('JSON.stringify({t:+out.time.toFixed(2), paused:out.paused, ended:!!out.ended, black:out.black, trim:out.trim, subs:out.subs, lyrics:out.lyrics, cd:!!out.countdown})');
  const first = await js('items[0].id');

  // ---------- lists ----------
  await js(`lists.push({ id: 'L1', name: 'Thursday', itemIds: [] }); saveLists(); openList('L1')`);
  await js(`addToActiveList([items[3].id, items[0].id])`);
  log('list view:', await js(`JSON.stringify(viewItems().map(x => x.title))`), '| head:', await js(`$('listName').textContent`));
  await js(`playItem(viewItems()[0])`); await wait(1200);
  log('playing from list, next is:', await js(`nextUp()?.title`), '| queue', await js(`JSON.stringify(queueItems().map(x => x.title))`));
  await shot('30-list');

  // ---------- start/end points through the dialog ----------
  await js(`openList(null); showItemSettings(items[0])`); await wait(400);
  await shot('31-item-settings');
  await js(`$('isStart').value = '0:02'; $('isEnd').value = '0:05'; $('isSave').click()`); await wait(300);
  log('trim saved:', await js(`JSON.stringify(items[0].trim)`), '| tag:', await js(`document.querySelector('.item .tag')?.textContent`));
  await js(`settings.fadeSec = 0; cmd('fade', { sec: 0 }); $('autoNext').checked = false; playItem(items[0])`);
  await wait(1500);
  log('starts at the start point:', await st());
  await wait(3500);
  log('stops at the end point:', await st(), '| status', await js(`$('statusPill').textContent`));
  await shot('32-trim-end');
  await js(`setTrim(items[0], null)`);

  // ---------- fades ----------
  await js(`settings.fadeSec = 1; cmd('fade', { sec: 1 }); playItem(items[0])`); await wait(2000);
  const t0 = Date.now();
  await js(`playItem(items[3])`);
  await wait(400);
  log('fading to the next video (0.4 s):', await ojs(`JSON.stringify({black: blackOn, fade: +fadeGain.gain.value.toFixed(2), src: decodeURI(v.src).split('/').pop()})`));
  await wait(1400);
  log('after the fade:', await ojs(`JSON.stringify({black: blackOn, src: decodeURI(v.src).split('/').pop(), t: +v.currentTime.toFixed(2)})`), Date.now() - t0, 'ms');
  await wait(800);
  log('sound back:', await ojs(`+fadeGain.gain.value.toFixed(2)`));
  await js(`settings.fadeSec = 0; cmd('fade', { sec: 0 })`);

  // ---------- standby text and picture ----------
  await js(`settings.standby = { kind: 'text', text: 'Welcome · أهلًا بكم' }; applyStandby(); cmd('black', { on: true })`); await wait(600);
  log('standby text:', await ojs(`JSON.stringify({shown: !document.getElementById('standbyText').hidden, text: document.getElementById('standbyText').textContent, opacity: getComputedStyle(standby).opacity, cls: standby.className, blackOn})`));
  log('  view', JSON.stringify(getMode().viewBounds), 'visible', await ojs('document.visibilityState'), 'raf', await ojs('new Promise(r => { let n = 0; const f = () => (++n < 5 ? requestAnimationFrame(f) : r(n)); requestAnimationFrame(f); setTimeout(() => r(n), 500); })'));
  await shot('33-standby-text');
  await js(`settings.standby = { kind: 'image', image: ${JSON.stringify(path.join(__dirname, 'media', 'sample-1.mp4'))} }; applyStandby()`); await wait(1500);
  log('standby video:', await ojs(`(e => JSON.stringify({shown: !e.hidden, playing: !e.paused, muted: e.muted, loop: e.loop, t: +e.currentTime.toFixed(1)}))(document.getElementById('standbyVid'))`));
  await shot('33b-standby-video');
  await js(`settings.standby = { kind: 'black' }; applyStandby(); cmd('black', { on: false })`);
  log('preview border:', await js(`getComputedStyle(document.querySelector('.preview')).borderColor`));

  // ---------- countdown ----------
  await js(`showCountdown()`); await wait(300);
  await shot('34-countdown-dialog');
  await js(`document.querySelector('#cdQuick button').click()`); await wait(1200);
  log('countdown:', await ojs(`JSON.stringify({on: document.getElementById('countdown').classList.contains('on'), time: document.querySelector('#countdown .time').textContent, msg: document.querySelector('#countdown .msg').textContent})`), '| pill', await js(`$('statusPill').textContent`));
  await shot('35-countdown');
  await js(`cmd('countdown', { until: 0 })`); await wait(400);
  log('countdown stopped:', await ojs(`document.getElementById('countdown').classList.contains('on')`));

  // ---------- lyrics ----------
  await js(`items[3].lyrics = 'First line\\nSecond line\\n\\nالمقطع الثاني\\nسطر آخر\\n\\nThird slide'; save(); playItem(items[3])`); await wait(1500);
  log('lyrics bar:', await js(`JSON.stringify({shown: !$('lyricsBar').hidden, slides: document.querySelectorAll('#lyricSlides .lyr').length})`));
  await js(`document.querySelectorAll('#lyricSlides .lyr')[1].click()`); await wait(500);
  log('lyric on screen:', await ojs(`JSON.stringify({on: document.getElementById('lyrics').classList.contains('on'), text: document.querySelector('#lyrics div').textContent, opacity: getComputedStyle(document.getElementById('lyrics')).opacity, rect: JSON.stringify(document.getElementById('lyrics').getBoundingClientRect())})`));
  await shot('36-lyrics');
  await js(`stepLyric(1)`); await wait(300);
  log('next slide:', await ojs(`document.querySelector('#lyrics div').textContent`));
  await js(`hideLyrics()`); await wait(300);
  log('lyrics hidden:', await ojs(`!document.getElementById('lyrics').classList.contains('on')`));

  // ---------- subtitles: a .srt next to the video is found by itself ----------
  {
    const video = path.join(dir, 'subbed.mp4');
    fs.copyFileSync(path.join(__dirname, 'media', 'sample-1.mp4'), video);
    fs.writeFileSync(path.join(dir, 'subbed.srt'), '1\r\n00:00:00,500 --> 00:00:08,000\r\nمرحبًا — Hello subtitles\r\n');
    await js(`addPaths([${JSON.stringify(video)}]); playItem(items.find(x => x.title === 'subbed'))`); await wait(2500);
    log('subtitles:', await ojs(`JSON.stringify({tracks: v.querySelectorAll('track').length, mode: v.textTracks[0]?.mode, cues: v.textTracks[0]?.cues?.length, active: v.textTracks[0]?.activeCues?.[0]?.text})`), '| chip:', await js(`$('activeChips').textContent`));
    await shot('37-subtitles');
    await js(`setSubsOn(false)`); await wait(300);
    log('subtitles off:', await ojs(`v.textTracks[0]?.mode`));
    await js(`setSubsOn(true)`);
  }

  // ---------- resume ----------
  await js(`items[0].duration = 300; items[0].resumeAt = 7; playItem(items[0])`); await wait(1500);
  log('resume:', await st(), '| chip:', await js(`$('resumeChip').hidden ? 'hidden' : $('resumeChip').textContent`));
  await js(`$('resumeChip').click()`); await wait(500);
  log('start over:', await st());
  await js(`items[0].duration = 20; items[0].resumeAt = 0`);

  // ---------- list check ----------
  await js(`items.push({ id: 'gone', title: 'Missing file', path: 'C:/nowhere/x.mp4', source: 'file', missing: true }, { id: 'net', title: 'Online video', path: 'https://youtu.be/x', url: 'https://youtu.be/x', source: 'stream' }); lists.find(l => l.id === 'L1').itemIds.push('gone', 'net'); openList('L1')`);
  log('check badge:', await js(`$('checkBadge').hidden ? 'hidden' : $('checkBadge').textContent`));
  await js(`showCheck()`); await wait(300);
  log('check rows:', await js(`[...document.querySelectorAll('.ck-row b')].map(b => b.textContent).join(' | ')`));
  await shot('38-check');
  await js(`closeModal(); items = items.filter(x => x.id !== 'gone' && x.id !== 'net'); forgetInLists('gone'); forgetInLists('net'); openList(null)`);

  // ---------- dialogs and popovers (for the screenshots) ----------
  await js(`playItem(items[0])`); await wait(1000);
  await js(`openPlaySettings()`); await wait(300);
  log('playback popover sections:', await js(`[...document.querySelectorAll('.ps-title')].map(x => x.textContent).join(' | ')`));
  await shot('39-playback-popover');
  await wait(300); log('video while the popover is open:', JSON.stringify(getMode().viewBounds));
  await js(`document.querySelector('.seg[data-k=rate] button[data-v="1.5"]').click()`); await wait(300);
  log('speed chip:', await js(`$('activeChips').textContent`), '| engine rate', await ojs('rate'));
  await js(`closeMenu(); setRate(1)`);
  await js(`showSettings()`); await wait(300); await shot('40-settings');
  await js(`showShortcuts()`); await wait(300); await shot('41-shortcuts');
  await js(`showOnboarding()`); await wait(300); await shot('42-tour');
  await js(`closeModal()`);
  log('tour sets onboarded:', await js('settings.onboarded'));
  await js(`setLang('ar'); showSettings()`); await wait(400); await shot('43-settings-ar');
  await js(`closeModal(); showItemSettings(items[0])`); await wait(300); await shot('44-item-settings-ar');
  await js(`closeModal(); setLang('en')`);

  // ---------- seek hover preview ----------
  await js(`(() => { const r = $('seek').getBoundingClientRect(); document.querySelector('.seek-track').dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.6, clientY: r.top + 3, bubbles: true })); })()`);
  await wait(900);
  log('scrub tip:', await js(`JSON.stringify({shown: !$('scrubTip').hidden, pic: $('scrubTip').classList.contains('pic'), time: $('scrubTip').textContent})`));
  await shot('45-scrub');
  await js(`document.querySelector('.seek-track').dispatchEvent(new PointerEvent('pointerleave'))`);

  // ---------- phone remote: the Wi-Fi page (no internet, lan.js) ----------
  // The same phone app, served by this computer. Its address is the PC's own on the network.
  const wifiOn = async () => {
    await js(`api.remoteStart().then(r => { remote = r; renderRemoteBtn(); })`);
    const t = Date.now();
    while (Date.now() - t < 10000 && !(await js(`!!link.lan?.urls?.length`))) await wait(200);
    const url = await js(`link.lan.urls[0]`);
    return { url, base: new URL(url).origin, key: new URL(url).searchParams.get('k') };
  };
  {
    const { url, base, key } = await wifiOn();
    log('Wi-Fi page on:', base, '| qr', await js(`!!link.lan.qr`));
    const noKey = await fetch(base + '/'), withKey = await fetch(`${base}/?k=${key}`, { redirect: 'manual' });
    log('page without key:', noKey.status, '| with key:', withKey.status, '→ cookie:', /mk=/.test(withKey.headers.get('set-cookie') || ''), '| bad request:', (await fetch(`${base}//`)).status);
    await js(`showRemote()`); await wait(500); await shot('46-remote');
    const { BrowserWindow } = require('electron');
    const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { offscreen: true, partition: 'wifi-test-' + Date.now() } });
    const wjs = code => w.webContents.executeJavaScript(code);
    await w.loadURL(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 10000 && !(await wjs(`!document.getElementById('remoteUi').hidden`))) await wait(200);
    log('Wi-Fi page connected in', Date.now() - t0, 'ms:', await wjs(`JSON.stringify({address: location.href, title: document.getElementById('title').textContent, videos: document.querySelectorAll('#list li').length})`));
    const before = await js('out.paused');
    await wjs(`document.getElementById('playBtn').click()`); await wait(700);
    log('Wi-Fi page play/pause:', before, '→', await js('out.paused'));
    await wjs(`[...document.querySelectorAll('#list li')][3].click()`); await wait(1200);
    log('Wi-Fi page picked a video:', await js(`items.find(x => x.id === playingId)?.title`), '| shows:', await wjs(`document.getElementById('title').textContent`));
    await wait(1000);
    log('Wi-Fi page thumbnails:', await wjs(`[...document.querySelectorAll('#list .th')].filter(e => e.style.backgroundImage).length`));
    log('remote button:', await js(`$('remoteBtn').className`), '| clients in dialog:', await js(`document.querySelector('.r-count')?.textContent`));
    fs.writeFileSync(path.join(dir, '47-remote-phone.png'), (await w.webContents.capturePage()).toPNG());
    w.destroy();
    await js(`closeModal(); api.remoteStop().then(r => { remote = r; renderRemoteBtn(); })`);
  }

  // ---------- checkpoints (and from the phone) ----------
  {
    await js(`playItem(items[0])`); await wait(1500);
    await js(`cmd('seek', { t: 4 })`); await wait(500);
    await js(`addMark({ rename: false })`);
    await js(`cmd('seek', { t: 12 })`); await wait(500);
    await js(`addMark()`); await wait(300);
    await js(`(i => { i.value = 'Verse 2'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); })(document.querySelector('.ml-edit'))`); await wait(300);
    log('checkpoints:', await js(`JSON.stringify(items[0].marks)`), '| rows:', await js(`[...document.querySelectorAll('#marksList .mark')].map(x => x.textContent.trim().replace(/\s+/g, ' ')).join(' | ')`), '| ticks:', await js(`document.querySelectorAll('.mark-ticks i').length`));
    await js(`document.querySelector('#marksList .mark').click()`); await wait(700);
    log('clicked the first checkpoint:', await js('out.time.toFixed(1)'));
    await shot('50-checkpoints');
    const { url } = await wifiOn();
    const { BrowserWindow } = require('electron');
    const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { offscreen: true, partition: 'wifi-marks-' + Date.now() } });
    const wjs = code => w.webContents.executeJavaScript(code);
    await w.loadURL(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 10000 && !(await wjs(`document.querySelectorAll('#marks button').length === 2`))) await wait(200);
    await wjs(`document.querySelectorAll('#marks button')[1].click()`); await wait(700);
    log('phone → checkpoint 2:', await js('out.time.toFixed(1)'));
    log('phone page:', await wjs(`JSON.stringify({marks: document.querySelectorAll('#marks button').length, seek: document.getElementById('seek').value})`));
    fs.writeFileSync(path.join(dir, '51-remote-phone-marks.png'), (await w.webContents.capturePage()).toPNG());
    w.destroy();
    await js(`api.remoteStop().then(r => { remote = r; renderRemoteBtn(); })`);
  }

  // ---------- the phone app (WebRTC, one link for the computer: hub.js) ----------
  // MA3MADAN_BASE points the link at a test copy of the server (else the real one).
  const SITE = process.env.MA3MADAN_BASE || 'https://ma3madan-remote.pages.dev';
  const linkOn = async () => {
    await js(`api.remoteStart().then(r => { remote = r; renderRemoteBtn(); })`);
    const t = Date.now();
    while (Date.now() - t < 15000 && !(await js(`!!(link.pairUrl && link.online)`))) await wait(300);
  };
  const linkOff = () => js(`api.remoteStop().then(r => { remote = r; renderRemoteBtn(); })`);
  const hostId = async () => decodeURIComponent((await js('link.pairUrl')).match(/pair=([^&]+)/)[1]).split('.')[0];
  {
    await js(`playItem(items[0])`); await wait(1000);
    await linkOn();
    const pair = await js(`link.pairUrl`);
    log('pairing link:', pair.replace(/pair=[^&]+/, 'pair=…'), '| room online:', await js('link.online'));
    const { BrowserWindow } = require('electron');
    const phone = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { offscreen: true, partition: 'qr-test-' + Date.now() } });
    await phone.loadURL(pair);
    const pjs = code => phone.webContents.executeJavaScript(code);
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && !(await pjs(`!document.getElementById('remoteUi').hidden`))) await wait(200);
    log('phone app connected in', Date.now() - t0, 'ms:', await pjs(`JSON.stringify({ui: !document.getElementById('remoteUi').hidden, title: document.getElementById('title').textContent, sub: document.getElementById('whoSub').textContent, route: link.route, saved: JSON.parse(localStorage.getItem('computers') || '[]').map(c => c.name + (c.key ? ' (own key)' : ''))})`));
    log('host sees phones:', await js(`link.phones.length`), '| trusted:', await js(`link.devices.length`), '| QR code changed after use:', (await js('link.pairUrl')) !== pair);
    const before = await js('out.paused');
    await pjs(`document.getElementById('playBtn').click()`); await wait(800);
    log('phone app play/pause:', before, '→', await js('out.paused'));
    await pjs(`[...document.querySelectorAll('#list li')][3].click()`); await wait(1500);
    log('phone app picked:', await js(`items.find(x => x.id === playingId)?.title`), '| phone shows:', await pjs(`document.getElementById('title').textContent`));
    await wait(1500);
    log('thumbnails over the link:', await pjs(`[...document.querySelectorAll('#list .th')].filter(e => e.style.backgroundImage).length`));
    fs.writeFileSync(path.join(dir, '52-phone-app.png'), (await phone.webContents.capturePage()).toPNG());
    // More of the app from the phone: lists, countdown, speed, options, a YouTube link.
    await pjs(`document.getElementById('cdBtn').click(); document.querySelector('#cdPanel [data-min="2"]').click()`); await wait(1200);
    log('phone countdown:', await js(`out.countdown ? Math.round((out.countdown.until - Date.now()) / 1000) + ' s' : 'none'`), '| phone shows:', await pjs(`document.getElementById('cdLabel').textContent`));
    await pjs(`document.getElementById('cdBtn').click(); document.getElementById('cdStop').click()`); await wait(1000);
    await pjs(`document.querySelector('#speedSeg [data-r="1.25"]').click()`); await wait(800);
    await pjs(`document.getElementById('loopBtn').click()`); await wait(800);
    log('phone speed/loop:', await js(`rate + ' ' + $('loopChk').checked`), '| phone shows:', await pjs(`document.querySelector('#speedSeg .on')?.textContent + ' loop ' + document.getElementById('loopBtn').classList.contains('on')`));
    await pjs(`document.querySelector('#speedSeg [data-r="1"]').click(); document.getElementById('loopBtn').click()`); await wait(800);
    log('phone list chips:', await pjs(`[...document.querySelectorAll('#listChips button')].map(b => b.textContent).join(' | ')`));
    await pjs(`[...document.querySelectorAll('#listChips button')][1]?.click()`); await wait(1000);
    log('phone opened list:', await js(`activeList()?.name || 'Recents'`), '| phone list:', await pjs(`document.querySelectorAll('#list li').length + ' videos'`));
    await pjs(`[...document.querySelectorAll('#listChips button')][0]?.click()`); await wait(800);
    if (process.env.VP_LINK_YT) {
      await pjs(`(i => { i.value = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; i.dispatchEvent(new Event('input')); })(document.getElementById('linkInput'))`);
      log('link actions shown:', await pjs(`!document.getElementById('linkActions').hidden`));
      await pjs(`document.getElementById('linkPlay').click()`);
      const tl = Date.now();
      while (Date.now() - tl < 60000 && !(await js(`!!items.find(x => x.url === 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' && !x.loading) && playingId === items.find(x => x.url === 'https://www.youtube.com/watch?v=aqz-KE-bpKQ')?.id && out.loaded && out.time > 0.5`))) await wait(1000);
      log('phone pasted a YouTube link → playing on the computer:', await js(`items.find(x => x.id === playingId)?.title`), 'in', Date.now() - tl, 'ms');
    }
    // The PPT tab: Ma3madan PPT isn't open here, on the same connection.
    await pjs(`document.querySelector('.tabs [data-tab="ppt"]').click()`); await wait(400);
    log('PPT tab without Ma3madan PPT:', await pjs(`document.getElementById('p-connTitle').textContent`));
    await pjs(`document.querySelector('.tabs [data-tab="play"]').click()`);
    // Reopen the app without the QR link: it must find the laptop by itself.
    await phone.loadURL(SITE + '/');
    const t1 = Date.now();
    while (Date.now() - t1 < 30000 && !(await pjs(`!document.getElementById('remoteUi').hidden`))) await wait(200);
    log('reopened without scanning, connected in', Date.now() - t1, 'ms:', await pjs(`!document.getElementById('remoteUi').hidden`));
    // The computer turns the remote off, then on again: the phone waits, then is back by itself.
    await linkOff(); await wait(2500);
    log('remote off → phone shows:', await pjs(`document.getElementById('connTitle').textContent`));
    await linkOn();
    const t2 = Date.now();
    while (Date.now() - t2 < 30000 && !(await pjs(`!document.getElementById('remoteUi').hidden`))) await wait(200);
    log('remote on again → phone back in', Date.now() - t2, 'ms:', await pjs(`!document.getElementById('remoteUi').hidden`));
    // Forget this phone on the computer: it's cut off and can't come back with its old key.
    const devId = await js(`link.devices[0].id`);
    await js(`LinkPage.op({ op: 'forget', id: ${JSON.stringify(devId)} })`);
    const t3 = Date.now();
    while (Date.now() - t3 < 20000 && (await pjs(`link.state`)) === 'connected') await wait(300);
    await wait(2500);
    log('forgotten on the computer → phone:', await pjs(`link.state + ' | ' + document.getElementById('connTitle').textContent`), '| trusted left:', await js('link.devices.length'));
    // And on the phone: forget the computer.
    await pjs(`window.confirm = () => true; document.getElementById('forgetBtn').click()`); await wait(500);
    log('forgotten on the phone → computers left:', await pjs(`JSON.parse(localStorage.getItem('computers') || '[]').length`), '| shows pairing:', await pjs(`!document.getElementById('pairScreen').hidden`));
    phone.destroy();
  }

  // ---------- a new phone finds this computer without the QR code ----------
  {
    const id = await hostId();
    const { BrowserWindow } = require('electron');
    const mk = () => new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { offscreen: true, partition: 'nearby-test-' + Date.now() } });
    let phone = mk();
    const pjs = code => phone.webContents.executeJavaScript(code);
    await phone.loadURL(SITE + '/');
    const t0 = Date.now();
    while (Date.now() - t0 < 40000 && !(await pjs(`!!document.querySelector('#nearbyList button[data-host="${id}"]')`))) await wait(500);
    log('nearby list:', await pjs(`[...document.querySelectorAll('#nearbyList button span')].map(s => s.textContent).join(', ')`), 'after', Date.now() - t0, 'ms');
    fs.writeFileSync(path.join(dir, '53-phone-nearby.png'), (await phone.webContents.capturePage()).toPNG());
    await pjs(`document.querySelector('#nearbyList button[data-host="${id}"]').click()`); // this test's own copy (the real app may be on too)
    const t1 = Date.now();
    while (Date.now() - t1 < 30000 && !(await js(`!!document.getElementById('linkRequest')`))) await wait(300);
    await wait(800);
    const pcCode = await js(`document.querySelector('#linkRequest code')?.textContent`);
    const phoneCode = await pjs(`document.getElementById('approveCode').hidden ? null : document.getElementById('approveCode').textContent`);
    log('approval asked in', Date.now() - t1, 'ms | code on the computer:', pcCode, '| on the phone:', phoneCode, '| match:', !!pcCode && pcCode === phoneCode);
    log('before approval the phone gets nothing:', await pjs(`document.getElementById('remoteUi').hidden`), '| host counts it:', await js('link.phones.length'));
    await shot('54-approve-request');
    fs.writeFileSync(path.join(dir, '55-phone-waiting.png'), (await phone.webContents.capturePage()).toPNG());
    await js(`document.querySelector('#linkRequest [data-a="trust"]').click()`); await wait(1500);
    log('trusted → phone remote:', await pjs(`JSON.stringify({ui: !document.getElementById('remoteUi').hidden, title: document.getElementById('title').textContent, saved: JSON.parse(localStorage.getItem('computers') || '[]').map(c => c.name + (c.key ? ' (own key)' : ''))})`));
    const before = await js('out.paused');
    await pjs(`document.getElementById('playBtn').click()`); await wait(800);
    log('trusted phone controls it:', before, '→', await js('out.paused'));
    // Next time: no list, no approval.
    await phone.loadURL(SITE + '/');
    const t2 = Date.now();
    while (Date.now() - t2 < 30000 && !(await pjs(`!document.getElementById('remoteUi').hidden`))) await wait(200);
    log('reopened: connected by itself in', Date.now() - t2, 'ms | asked again:', await js(`!!document.getElementById('linkRequest')`));
    phone.destroy();

    // Another phone: "Don't allow".
    phone = mk();
    await phone.loadURL(SITE + '/');
    const t3 = Date.now();
    while (Date.now() - t3 < 40000 && !(await pjs(`!!document.querySelector('#nearbyList button[data-host="${id}"]')`))) await wait(500);
    await pjs(`document.querySelector('#nearbyList button[data-host="${id}"]').click()`);
    const t4 = Date.now();
    while (Date.now() - t4 < 30000 && !(await js(`!!document.getElementById('linkRequest')`))) await wait(300);
    await js(`document.querySelector('#linkRequest [data-a="deny"]').click()`); await wait(1500);
    log('denied phone:', await pjs(`JSON.stringify({title: document.getElementById('connTitle').textContent, remote: !document.getElementById('remoteUi').hidden, saved: JSON.parse(localStorage.getItem('computers') || '[]').length})`));
    phone.destroy();
    await js(`LinkPage.op({ op: 'forgetAll' })`);
    await linkOff();
  }

  // ---------- karaoke button ----------
  log('karaoke button:', await js(`JSON.stringify({disabled: $('karaokeBtn').disabled, tip: $('karaokeBtn').dataset.tip || $('karaokeBtn').title})`));

  // ---------- copied YouTube link ----------
  {
    const { clipboard } = require('electron');
    process.env.VP_CLIPBOARD_TEST = '1';
    clipboard.writeText('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    log('  clipboard now:', clipboard.readText());
    getControl().emit('focus'); await wait(500);
    // With the screen locked Windows' clipboard can't be read: hand the link over directly instead.
    if (!clipboard.readText()) { log('  (clipboard unavailable: sending the link directly)'); getControl().webContents.send('clipboard-link', 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'); await wait(400); }
    log('copied link banner:', await js(`$('clipBanner').hidden ? 'hidden' : $('clipUrl').textContent`));
    await shot('48-clipboard');
    await js(`hideClip()`);
  }

  // ---------- mini mode ----------
  await js(`api.setMini(true)`); await wait(900);
  log('mini:', await js(`document.body.classList.contains('mini')`), JSON.stringify(getControl().getBounds()), '| on top', getControl().isAlwaysOnTop());
  await shot('49-mini');
  await js(`api.setMini(false)`); await wait(900);
  log('mini off:', await js(`document.body.classList.contains('mini')`), JSON.stringify(getControl().getBounds()), '| on top', getControl().isAlwaysOnTop());

  // ---------- search ----------
  await js(`openSearch(); $('searchInput').value = 'عينة'; $('searchInput').dispatchEvent(new Event('input'))`); await wait(300);
  log('search:', await js(`[...document.querySelectorAll('#playlist .item-title')].map(x => x.textContent).join(', ')`));
  await js(`closeSearch()`);
  await js(`openList(null)`);
};
