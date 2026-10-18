// Scripted end-to-end run: VP_SELFTEST=1 VP_SELFTEST_DIR=<dir> electron .
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = async ({ getControl, getOutput }) => {
  const dir = process.env.VP_SELFTEST_DIR;
  const log = (...a) => fs.appendFileSync(path.join(dir, 'log.txt'), a.join(' ') + '\n');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => getControl().webContents.executeJavaScript(code);
  const ojs = code => getOutput().webContents.executeJavaScript(code);
  const outState = async () => log('  output:', await ojs(`JSON.stringify({t:+v.currentTime.toFixed(2),split:followers.length>0,at:+a.currentTime.toFixed(2),paused:v.paused,vol:v.volume,muted:v.muted,black:blackOn,src:decodeURI(v.src).split('/').pop()})`));
  const shot = async name => {
    for (const [w, n] of [[getControl(), 'control'], [getOutput(), 'output']]) {
      const img = await w.capturePage();
      fs.writeFileSync(path.join(dir, `${name}-${n}.png`), img.toPNG());
    }
  };
  const key = async keyCode => {
    const wc = getControl().webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await wait(400);
  };
  try {
    await wait(1500);
    for (const [w, n] of [[getControl(), 'control'], [getOutput(), 'output']]) {
      w.webContents.on('console-message', (_e, level, msg) => log(`  [${n} console ${level}]`, msg));
    }
    await wait(1500);
    await wait(1500);
    log('opened from argv:'); await outState();
    await shot('0-start');
    const media = path.join(__dirname, 'media');
    const files = fs.readdirSync(media).map(f => path.join(media, f));
    await js(`addPaths(${JSON.stringify(files)})`);
    await wait(1500);
    log('items:', await js(`JSON.stringify(items.map(i=>[i.title,i.duration&&+i.duration.toFixed(1)]))`));

    await js(`playItem(items[0])`);
    await wait(3000);
    log('after play:'); await outState();
    log('preview stream:', await js(`JSON.stringify({has:!!$('preview').srcObject, w:$('preview').videoWidth, h:$('preview').videoHeight})`));
    await shot('1-playing');

    getControl().focus(); await wait(300);
    await key('Space'); log('after Space:'); await outState();
    await key('Down'); await key('Down'); log('after Down x2:'); await outState();
    await key('Right'); log('after Right:'); await outState();
    await key('M'); log('after M:'); await outState();
    await key('M');
    await key('B'); log('after B:'); await outState();
    await wait(600);
    await shot('2-paused-black');
    await key('B'); await key('Space');
    await key('N'); await wait(1500); log('after N:'); await outState();
    log('now title:', await js(`$('nowTitle').textContent`));

    // audio level through the gain node at 100% and 200%
    await js('playItem(items[0])'); await wait(1200);
    const rms = () => ojs(`new Promise(r=>{ if(!window._an){window._an=ctx.createAnalyser(); gain.connect(window._an);} const a=new Float32Array(2048); setTimeout(()=>{_an.getFloatTimeDomainData(a); r(+Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length).toFixed(4));},300); })`);
    await js('setVolume(1)'); await wait(300); log('rms @100%:', await rms());
    await js('setVolume(2)'); await wait(300); log('rms @200%:', await rms());
    await shot('2b-vol200');
    await js('setVolume(1)');
    await key('A'); await key('A'); log('aspect after A,A:', await ojs(`aspect + ' ' + v.style.width + 'x' + v.style.height`));
    await shot('2c-aspect');
    await js(`setAspect('default')`);
    await js(`setLang('ar')`); await wait(500); await shot('2d-arabic'); await js(`setLang('en')`);

    if (process.env.VP_YT) {
      await js(`$('ytUrl').value=${JSON.stringify(process.env.VP_YT)}; $('ytForm').requestSubmit()`);
      const start = Date.now();
      let last = '';
      while (Date.now() - start < 180000) {
        await wait(2000);
        const s = await js(`JSON.stringify({n:items.length, dl:[...downloads.values()].map(d=>[d.status,d.percent,d.title,d.error])})`);
        if (s !== last) { log('dl:', s); last = s; }
        if (JSON.parse(s).n > files.length || JSON.parse(s).dl.some(d => d[0] === 'error')) break;
      }
      await shot('3-downloaded');
      await js(`playItem(items[items.length-1])`);
      await wait(4000);
      log('youtube play:'); await outState();
      await shot('4-youtube-playing');

      // Same link as MP3 (fetches FFmpeg on first use)
      const before = await js('items.length');
      await js(`startDownload(${JSON.stringify(process.env.VP_YT)}, 'mp3')`);
      const t0 = Date.now();
      while (Date.now() - t0 < 240000) {
        await wait(2000);
        const s = await js(`JSON.stringify({ n: items.length, dl: [...downloads.values()].map(d => [d.status, d.error]) })`);
        if (JSON.parse(s).n > before || JSON.parse(s).dl.some(d => d[0] === 'error')) { log('mp3 dl:', s); break; }
      }
      log('mp3 item:', await js(`JSON.stringify(items.filter(x => /\\.mp3$/.test(x.path) && x.url).map(x => [x.title, x.path.split(/[\\\\/]/).pop()]))`));
    }
    if (process.env.VP_STREAM) {
      const t0 = Date.now();
      await js(`$('ytUrl').value=${JSON.stringify(process.env.VP_STREAM)}; $('ytForm').requestSubmit($('streamBtn'))`);
      await wait(500);
      while (Date.now() - t0 < 90000 && await js(`items.some(x=>x.loading)`)) await wait(500);
      log('stream added in', Date.now() - t0, 'ms:', await js(`JSON.stringify(items.filter(x=>x.source==='stream').map(x=>[x.title,x.duration]))`));
      // count audio seeks (the old cause of repeated words) and stalls
      await ojs(`window._aseeks=0; a.addEventListener('seeking',()=>window._aseeks++); window._stalls=0; setInterval(()=>{ if(stalled && !window._wasStalled) window._stalls++; window._wasStalled=stalled; },100); true`);
      const t1 = Date.now();
      await js(`playItem(items.find(x=>x.source==='stream'))`);
      while (Date.now() - t1 < 60000 && !(await ojs('v.currentTime > 0.5'))) await wait(300);
      log('stream started in', Date.now() - t1, 'ms');
      const snap = () => ojs(`JSON.stringify({t:+v.currentTime.toFixed(1), drift:+(a.currentTime-v.currentTime).toFixed(3), q:ladder[qIndex].label, auto:autoQuality, stalled, stalls:window._stalls, aseeks:window._aseeks, ahead:+bufferedAhead(v).toFixed(1), w:v.videoWidth+'x'+v.videoHeight})`);
      for (let i = 0; i < 4; i++) { await wait(10000); log('  normal net:', await snap()); }
      log('stream rms:', await rms());
      await shot('5-stream');
      // throttle the projector window to ~1 Mbps
      const dbg = getOutput().webContents.debugger;
      dbg.attach('1.3');
      await dbg.sendCommand('Network.enable');
      await dbg.sendCommand('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 1000000 / 8, uploadThroughput: 500000 / 8 });
      await js('cmd("seek",{t:400})');  // jump past the buffer so the slow link has to keep up
      for (let i = 0; i < 9; i++) { await wait(10000); log('  1 Mbps:', await snap()); }
      log('control toast:', await js(`$('toast').textContent`), '| quality ui:', await js(`$('qualitySel').selectedOptions[0]?.textContent`));
      await shot('6-throttled');
      dbg.detach();
    }
    // Real mouse clicks on play/pause while a video plays (each press held ~150 ms, like a person).
    await js('playItem(items[0])'); await wait(1500);
    const { x, y } = JSON.parse(await js(`JSON.stringify((b => ({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }))($('playBtn').getBoundingClientRect()))`));
    let clicksOk = 0;
    for (let i = 0; i < 10; i++) {
      const before = await ojs('wantPlay');
      const wc = getControl().webContents;
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      await wait(150);
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await wait(700);
      if ((await ojs('wantPlay')) !== before) clicksOk++;
    }
    log('play/pause mouse clicks that worked:', clicksOk, '/ 10');

    // Audio files play with sound only; the projector stays black.
    for (const name of ['tone.mp3', 'voice-note.opus']) {
      await js(`playItem(items.find(x => x.path.endsWith(${JSON.stringify(name)})))`);
      await wait(1500);
      await js(`cmd('black', { on: false })`); await wait(300); // even B must not uncover the projector
      log(`audio ${name}:`, await ojs(`JSON.stringify({ t: +v.currentTime.toFixed(1), playing: wantPlay, audioOnly, black: blackOn })`),
        '| rms', await rms(), '| badge shown:', await js(`!$('audioBadge').hidden`), '| output window visible:', getOutput().isVisible());
    }
    await shot('7-audio-only');
    await js('playItem(items[0])'); await wait(1500);
    log('back to video, output window visible:', getOutput().isVisible());

    // Item menu (⋯ / right-click)
    await js(`(() => { const li = document.querySelector('.item'); const r = li.getBoundingClientRect(); li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: r.left + 60, clientY: r.top + 20 })); })()`);
    await wait(300);
    log('item menu:', await js(`[...document.querySelectorAll('#menu button')].map(b => b.innerText).join(' | ')`));
    await shot('8-item-menu');
    await js('closeMenu()');
    // Vocal remover on this PC (VP_VOCALS=<a song with vocals>): first use downloads engine + model.
    if (process.env.VP_VOCALS) {
      const song = process.env.VP_VOCALS;
      await js(`settings.vocalEngine = 'local'; addPaths([${JSON.stringify(song)}])`);
      await wait(800);
      const t0 = Date.now();
      await js(`removeVocals(items.find(x => x.path === ${JSON.stringify(song)}))`);
      let lastStage = '';
      while (Date.now() - t0 < 600000) {
        await wait(1000);
        const s = await js(`JSON.stringify({ jobs: [...vocalJobs.values()].map(j => [j.stage, j.progress == null ? null : Math.round(j.progress * 100), j.error]), stems: !!items.find(x => x.path === ${JSON.stringify(song)}).stems })`);
        const st = JSON.parse(s);
        const stage = st.jobs[0]?.[0] || (st.stems ? 'done' : '?');
        if (stage !== lastStage) { log(`  vocals ${stage} at ${Math.round((Date.now() - t0) / 1000)} s`, s); lastStage = stage; }
        if (st.stems || st.jobs.some(j => j[0] === 'error')) break;
      }
      log('vocal removal took', Math.round((Date.now() - t0) / 1000), 's');
      await js(`playItem(items.find(x => x.path === ${JSON.stringify(song)}), { startAt: 60 })`);
      await wait(2500);
      const mixState = () => ojs(`JSON.stringify({ stems: stemsMode, followers: followers.length, mix, t: +v.currentTime.toFixed(1), drift: +(a2.currentTime - a.currentTime).toFixed(3) })`);
      for (const preset of ['karaoke', 'vocals', 'original']) {
        await js(`setMix(PRESETS.${preset})`); await wait(700);
        log(`  ${preset}:`, await mixState(), '| rms', await rms(), '| mixer shown:', await js(`!$('mixer').hidden`));
      }
      await js(`setMix({ music: 1, vocals: 0.5 })`); await wait(400);
      await shot('10-vocal-mixer');
      const it = JSON.parse(await js(`JSON.stringify(items.find(x => x.path === ${JSON.stringify(song)}))`));
      const dest = path.join(dir, 'mix-test.mp3');
      await require(path.join(__dirname, '..', 'src', 'vocals')).saveMix({ music: it.stems.music, vocals: it.stems.vocals, gains: { music: 1, vocals: 0.5 }, dest });
      log('saved mix:', fs.existsSync(dest) ? Math.round(fs.statSync(dest).size / 1024) + ' KB' : 'missing');
    }
    // Keyboard media keys arrive through the projector window's media session.
    {
      await js('playItem(items[0])'); await wait(1500);
      const states = [];
      for (const action of ['pause', 'play', 'pause', 'play']) {
        await ojs(`window.mediaKeyHandlers.${action}()`); await wait(700);
        states.push(`${action}→${(await ojs('wantPlay')) ? 'playing' : 'paused'}(${await ojs('v.paused') ? 'video paused' : 'video playing'})`);
      }
      log('media keys:', states.join(', '), '| OS sees:', await ojs('navigator.mediaSession.playbackState'));
      await ojs(`window.mediaKeyHandlers.nexttrack()`); await wait(1200);
      log('media next →', await js(`$('nowTitle').textContent`));
      const { globalShortcut } = require('electron');
      log('media keys reserved system-wide:', ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop'].map(k => `${k}=${globalShortcut.isRegistered(k)}`).join(' '));
      // The same press arriving twice (shortcut + media session) must act once.
      const before = await ojs('wantPlay');
      getControl().webContents.send('output-key', { code: 'MediaPlayPause' });
      await ojs(`window.mediaKeyHandlers.${before ? 'pause' : 'play'}()`);
      await wait(800);
      log('one press delivered twice:', before ? 'playing' : 'paused', '→', (await ojs('wantPlay')) ? 'playing' : 'paused');
    }

    // The ⋯ button opens its menu right next to it (real mouse click).
    {
      const more = JSON.parse(await js(`JSON.stringify((r => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }))(document.querySelector('.item .item-more').getBoundingClientRect()))`));
      const wc = getControl().webContents;
      wc.sendInputEvent({ type: 'mouseMove', x: more.x, y: more.y });
      wc.sendInputEvent({ type: 'mouseDown', x: more.x, y: more.y, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: more.x, y: more.y, button: 'left', clickCount: 1 });
      await wait(400);
      const menu = JSON.parse(await js(`JSON.stringify((m => m ? (r => ({ left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right) }))(m.getBoundingClientRect()) : null)(document.getElementById('menu')))`));
      log('⋯ at', JSON.stringify(more), '→ menu at', JSON.stringify(menu), menu && Math.abs(menu.top - more.y) < 60 && menu.right > more.x - 260 ? 'OK (next to the button)' : 'WRONG PLACE');
      await js('closeMenu()');
    }

    // "Remove vocals" on an online video: download it, then separate on this PC (VP_STREAM_VOCALS=<youtube url>).
    if (process.env.VP_STREAM_VOCALS) {
      const url = process.env.VP_STREAM_VOCALS;
      await js(`for (const [k, v] of [['vocalEngine', 'local']]) { settings[k] = v; api.setSetting(k, v); } addStream(${JSON.stringify(url)})`);
      const t0 = Date.now();
      while (Date.now() - t0 < 60000 && await js(`items.some(x => x.loading)`)) await wait(500);
      log('stream item menu:', await js(`(() => { const it = items.find(x => x.url === ${JSON.stringify(url)}); showItemMenu(it, 100, 100); const s = [...document.querySelectorAll('#menu button')].map(b => b.innerText).join(' | '); closeMenu(); return s; })()`));
      await js(`removeVocalsFromStream(items.find(x => x.url === ${JSON.stringify(url)}))`);
      let last = '';
      while (Date.now() - t0 < 900000) {
        await wait(2000);
        const s = await js(`JSON.stringify({ item: (it => it && [it.source, !!it.stems, it.stemsOn])(items.find(x => x.url === ${JSON.stringify(url)})), dl: [...downloads.values()].map(d => d.status), vj: [...vocalJobs.values()].map(j => j.stage) })`);
        const st = JSON.parse(s);
        const stage = `${st.item?.[0]} dl=${st.dl.join(',')} vj=${st.vj.join(',')}`;
        if (stage !== last) { log(`  ${Math.round((Date.now() - t0) / 1000)} s:`, s); last = stage; }
        if (st.item?.[1] || st.vj.includes('error')) break;
      }
      await js(`playItem(items.find(x => x.url === ${JSON.stringify(url)}), { startAt: 3 })`);
      await wait(2500);
      log('online video → karaoke:', await ojs(`JSON.stringify({ stems: stemsMode, followers: followers.length, mix, w: v.videoWidth })`), '| mixer shown:', await js(`!$('mixer').hidden`));
    }

    // Online path with a bad key: should fail with MVSEP's message and reopen the key window.
    if (process.env.VP_VOCALS || process.env.VP_BADKEY) {
      await js(`for (const [k, v] of [['vocalEngine', 'online'], ['mvsepToken', 'not-a-real-key']]) { settings[k] = v; api.setSetting(k, v); }
        removeVocals(items.find(x => x.path.endsWith('tone.mp3')))`);
      const t1 = Date.now();
      while (Date.now() - t1 < 60000) {
        await wait(1500);
        const s = await js(`JSON.stringify([...vocalJobs.values()].map(j => [j.stage, j.error]))`);
        if (/error/.test(s)) { log('online with a bad key:', s, '| key window open:', await js(`!$('modal').hidden`)); break; }
      }
      await shot('11-vocal-bad-key');
    }

    // Updater (VP_FAKE_VERSION=older version, VP_UPDATE_DRYRUN=1: download + verify, don't install)
    if (process.env.VP_FAKE_VERSION) {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000 && await js(`$('updateBtn').hidden`)) await wait(500);
      log('update button:', await js(`$('updateBtn').hidden ? 'hidden' : $('updateBtn').innerText`));
      await shot('9-update-available');
      await js(`$('toast').textContent = ''; $('updateBtn').click()`);
      const t1 = Date.now();
      let seen = '';
      while (Date.now() - t1 < 300000) {
        await wait(1000);
        const label = await js(`$('updateBtn').innerText`);
        if (label !== seen && /%/.test(label) && /[05]0%/.test(label)) { log('  ', label); seen = label; }
        const msg = await js(`$('toast').textContent`);
        if (msg) { log('update result:', msg, `(${Math.round((Date.now() - t1) / 1000)} s)`); break; }
      }
    }
    log('DONE');
  } catch (e) {
    log('FAIL', e.stack);
  }
  app.quit();
};
