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
  await js(`settings.standby = { kind: 'black' }; applyStandby(); cmd('black', { on: false })`);

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

  // ---------- phone remote ----------
  {
    const r = JSON.parse(await js(`api.remoteStart().then(r => JSON.stringify(r))`));
    log('remote on:', r.ok, '| urls', JSON.stringify(r.urls), '| qr', !!r.qr);
    const key = new URL(r.urls?.[0] || `http://127.0.0.1:${r.port}/?k=x`).searchParams.get('k');
    const base = `http://127.0.0.1:${r.port}`;
    log('page without key:', (await fetch(base + '/')).status, '| with key:', (await fetch(`${base}/?k=${key}`)).status);
    await js(`showRemote()`); await wait(500); await shot('46-remote');
    const ctrl = new AbortController();
    const ev = await fetch(`${base}/events?k=${key}`, { signal: ctrl.signal });
    const reader = ev.body.getReader();
    const firstMsg = new TextDecoder().decode((await reader.read()).value);
    // A read can hold more than one event: take the first.
    const state = JSON.parse(firstMsg.split('\n\n')[0].replace(/^data: /, ''));
    log('remote state:', JSON.stringify({ title: state.title, items: state.items?.length, paused: state.paused }));
    const before = await js('out.paused');
    await fetch(`${base}/cmd?k=${key}`, { method: 'POST', body: JSON.stringify({ action: 'toggle' }) });
    await wait(700);
    log('remote play/pause:', before, '→', await js('out.paused'));
    await fetch(`${base}/cmd?k=${key}`, { method: 'POST', body: JSON.stringify({ action: 'play', id: await js('items[3].id') }) });
    await wait(1200);
    log('remote picked a video:', await js(`items.find(x => x.id === playingId)?.title`));
    log('remote button:', await js(`$('remoteBtn').className`), '| clients in dialog:', await js(`document.querySelector('.r-count')?.textContent`));
    ctrl.abort();
    // The phone page itself, rendered.
    const { BrowserWindow } = require('electron');
    const w = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { offscreen: true } });
    await w.loadURL(`${base}/?k=${key}`); await wait(1500);
    fs.writeFileSync(path.join(dir, '47-remote-phone.png'), (await w.webContents.capturePage()).toPNG());
    log('phone page:', await w.webContents.executeJavaScript(`document.getElementById('title').textContent + ' | ' + document.querySelectorAll('#list li').length + ' videos'`));
    w.destroy();
    await js(`closeModal(); api.remoteStop().then(r => { remote = r; renderRemoteBtn(); })`);
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
