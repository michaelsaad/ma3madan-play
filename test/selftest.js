// Scripted end-to-end run: VP_SELFTEST=1 VP_SELFTEST_DIR=<dir> electron .
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = async ({ getControl, getOutput, getOutputWin, getMode, setMode }) => {
  const dir = process.env.VP_SELFTEST_DIR;
  const log = (...a) => fs.appendFileSync(path.join(dir, 'log.txt'), a.join(' ') + '\n');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => getControl().webContents.executeJavaScript(code).catch(e => { throw new Error('in control: ' + code.slice(0, 120) + ' → ' + (e?.message || JSON.stringify(e))); });
  const ojs = code => getOutput().webContents.executeJavaScript(code).catch(e => { throw new Error('in output: ' + code.slice(0, 120) + ' → ' + (e?.message || JSON.stringify(e))); });
  const outState = async () => log('  output:', await ojs(`JSON.stringify({t:+v.currentTime.toFixed(2),split:followers.length>0,at:+a.currentTime.toFixed(2),paused:v.paused,vol:v.volume,muted:v.muted,black:blackOn,src:decodeURI(v.src).split('/').pop()})`));
  const shot = async name => {
    const imgs = {};
    for (const [w, n] of [[getControl(), 'control'], [getOutput(), 'output']]) {
      const img = imgs[n] = await w.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${name}-${n}.png`), img.toPNG());
    }
    // In Player mode the video is a separate layer over the page: paint it in, as the user sees it.
    const m = getMode();
    if (m.mode === 'player' && m.viewBounds.width > 0) await composite(imgs.control, imgs.output, m.viewBounds, path.join(dir, `${name}-window.png`)).catch(e => log('  (no composite for', name + ':', e?.message || 'image', ')'));
  };
  const composite = async (page, video, at, file) => {
    const { BrowserWindow } = require('electron');
    const k = page.getSize().width / getControl().getContentBounds().width;
    const blank = path.join(dir, 'blank.html');
    fs.writeFileSync(blank, '<!doctype html><body></body>');
    const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
    await w.loadFile(blank);
    const url = await w.webContents.executeJavaScript(`(async () => {
      const load = src => { const i = new Image(); i.src = src; return i.decode().then(() => i); };
      const [a, b] = await Promise.all([load(${JSON.stringify(page.toDataURL())}), load(${JSON.stringify(video.toDataURL())})]);
      const c = document.createElement('canvas'); c.width = a.width; c.height = a.height;
      const g = c.getContext('2d'); g.drawImage(a, 0, 0);
      g.drawImage(b, ${at.x * k}, ${at.y * k}, ${at.width * k}, ${at.height * k});
      return c.toDataURL('image/png');
    })()`);
    w.destroy();
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
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
    const features = () => require('./features')({ js, ojs, log, wait, shot, dir, getControl, getMode, getOutput });
    if (process.env.VP_FEATURES) { await features(); log('DONE'); app.quit(); return; }
    if (process.env.VP_UI_ONLY) { await require('./ui')({ js, log, wait, shot }); log('DONE'); app.quit(); return; }
    if (process.env.VP_STREAM_ONLY) { await require('./stream')({ js, ojs, log, wait }); log('DONE'); app.quit(); return; }

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
      const n0 = await js('items.length');
      await js(`startDownload(${JSON.stringify(process.env.VP_YT)}, 'video')`);
      const start = Date.now();
      let last = '';
      while (Date.now() - start < 180000) {
        await wait(2000);
        const s = await js(`JSON.stringify({n:items.length, dl:[...downloads.values()].map(d=>[d.status,d.percent,d.title,d.error])})`);
        if (s !== last) { log('dl:', s); last = s; }
        if ((JSON.parse(s).n > n0 && !JSON.parse(s).dl.length) || JSON.parse(s).dl.some(d => d[0] === 'error')) break;
      }
      await shot('3-downloaded');
      await js(`playItem(items[items.length-1])`);
      await wait(4000);
      log('youtube play:'); await outState();
      await shot('4-youtube-playing');
      // One ordinary MP4 with picture and sound, no separate .m4a next to it.
      {
        const file = await js('items[items.length-1].path');
        const ffmpeg = await require(path.join(__dirname, '..', 'src', 'youtube')).ensureFfmpeg();
        const info = require('child_process').spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
        const streams = (info.match(/Stream #\S+.*?: (Video|Audio)/g) || []).map(x => x.split(': ').pop());
        const siblings = fs.readdirSync(path.dirname(file)).filter(n => n.startsWith(path.basename(file, '.mp4')));
        log('download file:', path.basename(file), '| streams', streams.join('+'), '| files with that name', JSON.stringify(siblings));
      }

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
      // A slow connection (~1.5 Mbit/s): quality must step down.
      const proxy = require('../src/stream-proxy');
      proxy.setTestLimit(1.5e6);
      await js('cmd("seek",{t:400})');  // jump past the buffer so the slow link has to keep up
      for (let i = 0; i < 9; i++) { await wait(10000); log('  1.5 Mbps:', await snap(), '| speed', JSON.stringify(proxy.lastSpeed())); }
      log('quality chip:', await js("$('activeChips').textContent"));
      await shot('6-throttled');
      // The connection gets good again: quality must climb back up without a pause.
      proxy.setTestLimit(0);
      for (let i = 0; i < 9; i++) { await wait(10000); log('  fast again:', await snap(), '| speed', JSON.stringify(proxy.lastSpeed()), '| upgrading', await ojs('upgrade ? ladder[upgrade.i].label : "-"')); }
      log('quality chip:', await js("$('activeChips').textContent"));
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
        '| rms', await rms(), '| badge shown:', await js(`!$('audioBadge').hidden`), '| player view:', JSON.stringify(getMode().viewBounds));
    }
    await shot('7-audio-only');
    await js('playItem(items[0])'); await wait(1500);
    log('back to video, player view:', JSON.stringify(getMode().viewBounds));

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
    // Player mode (single screen): the engine sits on the preview box inside the control window.
    {
      await js('playItem(items[0])'); await wait(1500);
      const rect = JSON.parse(await js(`(r => JSON.stringify({ x: Math.round(r.left + 2), y: Math.round(r.top + 2), width: Math.round(r.width - 4), height: Math.round(r.height - 4) }))(document.querySelector('.preview').getBoundingClientRect())`));
      const m = getMode();
      const close = (a, b) => Math.abs(a - b) <= 2;
      log('player mode:', m.mode, 'home', m.home, '| view', JSON.stringify(m.viewBounds), '| preview', JSON.stringify(rect),
        ['x', 'y', 'width', 'height'].every(k => close(m.viewBounds[k], rect[k])) ? 'MATCH' : 'MISMATCH', '| rms', await rms());
      const t1 = await ojs('v.currentTime');
      getControl().webContents.send('output-key', { code: 'DblClick' }); await wait(1200);
      const fs1 = getMode(); const cb = getControl().getContentBounds();
      log('fullscreen:', fs1.playerFullscreen, getControl().isFullScreen(), '| view', JSON.stringify(fs1.viewBounds), 'window', cb.width + 'x' + cb.height);
      await shot('16-player-fullscreen');
      getControl().webContents.send('output-key', { code: 'Escape' }); await wait(1200);
      log('after Esc:', getMode().playerFullscreen, getControl().isFullScreen(), '| kept playing:', (await ojs('v.currentTime')) > t1);
      log('Show on button with one screen:', await js(`!$('showOnBtn').hidden`), '| label', await js(`$('showOnLabel').textContent`));
      // The About window must not be covered by the video layer.
      await js(`$('aboutBtn').click()`); await wait(400);
      log('view while a dialog is open:', JSON.stringify(getMode().viewBounds));
      await js(`$('aboutClose').click()`); await wait(400);
      // Window: restore to a normal size and snap to half the screen.
      const ctl = getControl();
      ctl.unmaximize(); await wait(500);
      const wa = require('electron').screen.getPrimaryDisplay().workArea;
      ctl.setBounds({ x: wa.x, y: wa.y, width: Math.round(wa.width / 2), height: wa.height }); await wait(800);
      const b = ctl.getBounds();
      log('half screen:', b.width + 'x' + b.height, 'asked', Math.round(wa.width / 2) + 'x' + wa.height, '| view follows:', JSON.stringify(getMode().viewBounds));
      await shot('17-half-screen');
      ctl.maximize(); await wait(800);
    }

    // Layout: the side panel resizes and hides (the video follows), Recents scrolls, Screen stays visible.
    {
      const close = (a, b) => Math.abs(a - b) <= 2;
      const viewMatches = async () => {
        const r = JSON.parse(await js(`(r => JSON.stringify({ x: Math.round(r.left + 2), y: Math.round(r.top + 2), width: Math.round(r.width - 4), height: Math.round(r.height - 4) }))(document.querySelector('.preview').getBoundingClientRect())`));
        const v = getMode().viewBounds;
        return ['x', 'y', 'width', 'height'].every(k => close(v[k], r[k])) ? 'MATCH' : `MISMATCH view ${JSON.stringify(v)} box ${JSON.stringify(r)}`;
      };
      const sideW = () => js(`Math.round(document.querySelector('.side').getBoundingClientRect().width)`);
      log('side panel width:', await sideW());
      await js(`settings.sidebarWidth = 520; applySide()`); await wait(600);
      log('resized to 520:', await sideW(), '| video', await viewMatches());
      await js(`settings.sidebarWidth = 100; applySide()`); await wait(400);
      log('asked 100 (min 260):', await sideW());
      await js(`$('sideGrip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await wait(400);
      log('double-click resets:', await sideW());
      getControl().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'B', modifiers: ['control'] }); await wait(600);
      log('Ctrl+B hides:', await js(`document.body.classList.contains('side-hidden') && getComputedStyle(document.querySelector('.side')).display === 'none'`), '| video', await viewMatches());
      await shot('18-side-hidden');
      await js(`$('sideBtn').click()`); await wait(600);
      await js(`setLang('ar')`); await wait(700);
      log('Arabic (box moves to the other side): video', await viewMatches());
      await js(`setLang('en')`); await wait(700);
      log('button shows again:', await js(`!document.body.classList.contains('side-hidden')`), '| video', await viewMatches());
      // Recents with many items scrolls inside the panel.
      const saved = await js('JSON.stringify(items)');
      await js(`for (let i = 0; i < 40; i++) items.push({ ...items[0], id: 'fill' + i, title: 'Filler item ' + i }); renderList()`); await wait(400);
      log('Recents scrolls:', await js(`(l => l.scrollHeight > l.clientHeight + 10)($('playlist'))`),
        '| full screen button visible:', await js(`$('fullBtn').offsetParent !== null`));
      await shot('19-many-recents');
      await js(`items = ${saved}; renderList()`); await wait(300);
    }

    // Freeze: the audience keeps a still frame while the video runs on; frame-by-frame stepping.
    {
      await js('playItem(items[0])'); await wait(2000);
      await js(`$('freezeBtn').click()`); await wait(600);
      const t0 = await ojs('v.currentTime');
      await wait(1500);
      log('freeze:', await ojs('JSON.stringify({ frozen, canvas: !freezeCv.hidden, size: freezeCv.width + "x" + freezeCv.height })'),
        '| video kept running:', (await ojs('v.currentTime')) > t0 + 1, '| button on:', await js(`$('freezeBtn').classList.contains('on')`), '| badge:', await js(`!$('frozenBadge').hidden`));
      // Presenter-style live frames for the preview (forced here: one screen has no projector).
      await ojs('handlers.playerMode({ on: false })'); await wait(1200);
      log('live frames in the preview:', await js(`!$('liveFrame').hidden && $('liveFrame').naturalWidth`));
      await ojs('handlers.playerMode({ on: true })');
      await js(`$('freezeBtn').click()`); await wait(600);
      log('unfrozen:', await ojs('JSON.stringify({ frozen, canvas: !freezeCv.hidden })'), '| preview frame hidden:', await js(`$('liveFrame').hidden`));
      // Frame by frame
      const before = await ojs('v.currentTime');
      const down = id => js(`$('${id}').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }))`);
      const up = id => js(`$('${id}').dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))`);
      await down('frameFwdBtn'); await up('frameFwdBtn'); await wait(500);
      const one = await ojs('v.currentTime');
      log('one frame forward:', (one - before).toFixed(3), 's | paused:', await ojs('!wantPlay'), '| frame length', (await ojs('frameDur')).toFixed(4));
      await down('frameFwdBtn'); await wait(1500); await up('frameFwdBtn'); await wait(300);
      const held = await ojs('v.currentTime');
      log('held 1.5 s:', Math.round((held - one) / (await ojs('frameDur'))), 'frames');
      await down('frameBackBtn'); await up('frameBackBtn'); await wait(500);
      log('one frame back:', ((await ojs('v.currentTime')) - held).toFixed(3), 's');
      await shot('21-frame-step');
    }

    // Show on: the screen map (a second screen is simulated; this PC may have only one).
    {
      await js(`modeState = { ...modeState, canPresent: true, showOn: { screens: [2], here: false }, screens: [
        { id: 1, n: 1, here: true, width: 1920, height: 1080, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
        { id: 2, n: 2, here: false, width: 1920, height: 1080, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }] }; renderMode(); openShowOn()`);
      await wait(800);
      log('show on menu:', await js(`JSON.stringify({ label: $('showOnLabel').textContent, screens: [...document.querySelectorAll('.so-screen')].map(b => b.innerText.split(String.fromCharCode(10)).join(' ') + (b.classList.contains('on') ? ' [on]' : '')), video: getComputedStyle(document.querySelector('#menu')).display })`),
        '| video layer while open:', JSON.stringify(getMode().viewBounds));
      await shot('22-show-on');
      await js('closeMenu(); api.getDisplays()'); await wait(600);
      log('after closing:', JSON.stringify(getMode().viewBounds), '| Show on button:', await js(`!$('showOnBtn').hidden`));
    }

    // Mirror page (a real second screen isn't available here): it loads, has the bridge, no errors.
    {
      const { BrowserWindow } = require('electron');
      const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js') } });
      const msgs = [];
      w.webContents.on('console-message', (_e, level, message) => { if (level >= 2) msgs.push(message); });
      await w.loadFile(path.join(__dirname, '..', 'src', 'mirror.html'));
      await wait(1500);
      log('mirror page:', await w.webContents.executeJavaScript('typeof api.outputSourceId + " " + typeof start'), '| errors:', JSON.stringify(msgs));
      w.destroy();
    }

    // Theme: same as Windows → light → dark; the page and the native title-bar buttons follow.
    {
      const { nativeTheme } = require('electron');
      const startTheme = await js('settings.theme || "system"');
      for (let i = 0; i < 3; i++) {
        await js(`setTheme(['light','dark','system'][${i}])`); await wait(700);
        log('theme', await js('settings.theme'), '| source', nativeTheme.themeSource, '| dark', nativeTheme.shouldUseDarkColors,
          '| --bg', await js(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`),
          '');
        await shot(`20-theme-${await js('settings.theme')}`);
      }
      log('theme back to', await js('settings.theme'), '(started', startTheme + ')');
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

    // Now playing: a long title fades at its edge and scrolls on hover (English and Arabic).
    for (const title of ['A very long English title that certainly does not fit on one line of the now playing area at all, really', 'من قال فكان دون امرك … من امر فصار دون علمك #ترنيمة فريق الحياة الافضل مع المعلم بولا منير وخورس القداس الالهي لعيد الغطاس المجيد 2025 لحن اوران انشوشو']) {
      await js(`items[0].title = ${JSON.stringify(title)}; playItem(items[0])`); await wait(1200);
      const box = await js(`(() => { const b = $('nowTitle'), s = b.firstElementChild, r = b.getBoundingClientRect(); return JSON.stringify({ overflowing: b.classList.contains('overflowing'), dir: getComputedStyle(b).direction, box: Math.round(r.width), text: s.scrollWidth, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`);
      const b = JSON.parse(box);
      await shot(`14-title-${/[a-z]/i.test(title[0]) ? 'en' : 'ar'}`);
      getControl().webContents.sendInputEvent({ type: 'mouseMove', x: b.x, y: b.y });
      await wait(3500);
      const moved = await js(`$('nowTitle').firstElementChild.style.transform`);
      log(`title ${/[a-z]/i.test(title[0]) ? 'en' : 'ar'}:`, box, '| on hover:', moved || 'no move');
      await shot(`15-title-hover-${/[a-z]/i.test(title[0]) ? 'en' : 'ar'}`);
      getControl().webContents.sendInputEvent({ type: 'mouseMove', x: 5, y: 500 });
      await wait(600);
    }
    log('next line:', await js(`(n => JSON.stringify({ text: n.innerText, size: getComputedStyle(n).fontSize, opacity: getComputedStyle(n).opacity }))($('nextTitle'))`));

    // About window from the ⓘ next to the name, with a real update check against GitHub.
    {
      log('ⓘ vs name:', await js(`(() => { const n = document.querySelector('.brand-name').getBoundingClientRect(), b = $('aboutBtn').getBoundingClientRect(); return JSON.stringify({ nameMidY: +(n.top + n.height / 2).toFixed(1), iconMidY: +(b.top + b.height / 2).toFixed(1), gapPx: Math.round(b.left - n.right) }); })()`));
      await js(`$('aboutBtn').click()`); await wait(500);
      log('about:', await js(`$('modal').hidden ? 'not shown' : $('modal').innerText.replace(/\\s+/g, ' ').slice(0, 200)`));
      await js(`$('aboutCheck').click()`);
      for (let i = 0; i < 20 && /Checking|^$/.test(await js(`$('aboutStatus').textContent`)); i++) await wait(500);
      log('about update check:', await js(`$('aboutStatus').textContent`));
      await shot('13-about');
      await js(`$('aboutClose').click()`);
      await js(`setLang('ar'); $('aboutBtn').click()`); await wait(500);
      await shot('13-about-ar');
      await js(`$('aboutClose').click(); setLang('en')`);
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

    // Play given stems and watch each track (VP_STEMS="<source>|<music>|<vocals>").
    if (process.env.VP_STEMS) {
      const [source, music, vocals] = process.env.VP_STEMS.split('|');
      await js(`items.push({ id: 'stemtest', title: 'stem test', path: ${JSON.stringify(source)}, source: 'file', stems: { music: ${JSON.stringify(music)}, vocals: ${JSON.stringify(vocals)} }, stemsOn: true, mix: { music: 0, vocals: 1 } }); renderList(); playItem(items.find(x => x.id === 'stemtest'))`);
      await wait(1500);
      for (let i = 0; i < 6; i++) {
        log('  audio engine:', await ojs(`(() => { if (!window._an2) { window._an2 = ctx.createAnalyser(); a2Gain.connect(window._an2); } const d = new Float32Array(2048); _an2.getFloatTimeDomainData(d); return JSON.stringify({ state: ctx.state, clock: +ctx.currentTime.toFixed(2), vocalsRms: +Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length).toFixed(4), visible: document.visibilityState }); })()`));
        log('  stems:', await ojs(`JSON.stringify({ t: +v.currentTime.toFixed(2), music: [+a.currentTime.toFixed(2), a.paused, a.readyState, aGain.gain.value], vocals: [+a2.currentTime.toFixed(2), a2.paused, a2.readyState, a2Gain.gain.value, a2.error && a2.error.message] })`), '| rms', await rms());
        await wait(700);
      }
    }

    // Online separation with the real key saved by the installed app (VP_ONLINE_REAL=<youtube url>).
    // The key is copied into this test's settings and never logged.
    if (process.env.VP_ONLINE_REAL) {
      const url = process.env.VP_ONLINE_REAL;
      const real = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), 'Ma3madan Play', 'settings.json'), 'utf8'));
      await js(`for (const [k, v] of [['vocalEngine', 'online'], ['mvsepToken', ${JSON.stringify(real.mvsepToken || '')}]]) { settings[k] = v; api.setSetting(k, v); } addStream(${JSON.stringify(url)})`);
      const t0 = Date.now();
      while (Date.now() - t0 < 60000 && await js(`items.some(x => x.loading)`)) await wait(500);
      await js(`removeVocalsFromStream(items.find(x => x.url === ${JSON.stringify(url)}))`);
      let last = '';
      while (Date.now() - t0 < 1200000) {
        await wait(2000);
        const s = await js(`JSON.stringify({ item: (it => it && [it.source, !!it.stems])(items.find(x => x.url === ${JSON.stringify(url)})), dl: [...downloads.values()].map(d => d.status), vj: [...vocalJobs.values()].map(j => [j.stage, j.position ?? null, j.progress == null ? null : Math.round(j.progress * 100), j.error]) })`);
        const st = JSON.parse(s);
        const key = JSON.stringify([st.item, st.dl, st.vj.map(j => j[0])]);
        if (key !== last) { log(`  online ${Math.round((Date.now() - t0) / 1000)} s:`, s); last = key; }
        if (st.item?.[1] || st.vj.some(j => j[0] === 'error')) break;
      }
      const it = JSON.parse(await js(`JSON.stringify(items.find(x => x.url === ${JSON.stringify(url)}))`));
      if (it.stems) {
        log('online stems:', ['music', 'vocals'].map(k => `${k} ${Math.round(fs.statSync(it.stems[k]).size / 1024)} KB`).join(', '));
        await js(`playItem(items.find(x => x.url === ${JSON.stringify(url)}), { startAt: 2 })`);
        await wait(2500);
        for (const preset of ['karaoke', 'vocals']) {
          await js(`setMix(PRESETS.${preset})`); await wait(800);
          log(`  online ${preset}: rms`, await rms());
        }
        await shot('12-online-karaoke');
      }
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
      await js(`$('toast').textContent = ''; $('updateBtn').click()`); await wait(400);
      log('update dialog:', await js(`[...document.querySelectorAll('.upd-notes h4, .upd-notes li')].slice(0, 4).map(x => x.textContent).join(' | ')`));
      await js(`$('updInstall').click()`);
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
    // README screenshots (VP_README_SHOTS=1 with VP_STREAM=<a YouTube link>): the streamed video
    // playing in Player mode, English dark and light, Arabic dark.
    if (process.env.VP_README_SHOTS) {
      const url = process.env.VP_STREAM;
      await js(`closeModal(); closeMenu(); items = items.filter(x => !x.id?.startsWith?.('fill')); renderList()`);
      if (url) await js(`playItem(items.find(x => x.url === ${JSON.stringify(url)}), { startAt: 40 })`);
      await wait(8000);
      getControl().webContents.sendInputEvent({ type: 'mouseMove', x: 1000, y: 735 }); // no tooltip in the pictures
      for (const [lang, theme] of [['en', 'dark'], ['en', 'light'], ['ar', 'dark']]) {
        await js(`setLang('${lang}'); settings.theme = '${theme}'; api.setTheme('${theme}'); 0`); await wait(1500);
        await shot(`readme-${lang}-${theme}`);
        log(`readme ${lang}-${theme}:`, JSON.stringify(getMode().viewBounds), getMode().mode, "| modal hidden", await js("$(\x27modal\x27).hidden"), "| menu", await js("!!document.getElementById(\x27menu\x27)"), "| audioOnly", await js("!!(out.loaded && out.audioOnly)"));
      }
      await js(`setLang('en'); settings.theme = 'system'; api.setTheme('system'); 0`);
    }

    await features();
    log('DONE');
  } catch (e) {
    log('FAIL', e?.stack || e?.message || JSON.stringify(e) || String(e));
  }
  app.quit();
};
