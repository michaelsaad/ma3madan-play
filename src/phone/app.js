// Ma3madan Remote: the phone app. Two tabs, one per app on the computer:
// - Ma3madan Play (videos), and
// - Ma3madan PPT (PowerPoint).
// Each tab pairs with its own app by scanning that app's QR code (or from "Nearby computers",
// approved on the computer), then talks to it directly over the Wi-Fi (see link.js). Both can be
// connected at the same time.
const $ = id => document.getElementById(id);

// ---------- strings ----------
const S = {
  en: {
    standby: 'Standby', freeze: 'Freeze', stop: 'Stop', lyrics: 'Lyrics', hide: 'Hide', marks: 'Checkpoints', addHere: '+ Here',
    next: 'Next: ', nothing: 'Nothing playing', live: 'LIVE', standbyOn: 'Standby', paused: 'Paused', videos: '{n} videos', recents: 'Recents',
    pairTitle: 'Connect to your computer', pair1: 'On the computer, open Ma3madan Play or Ma3madan PPT.', pair2: 'Click the phone button at the top, then turn the remote on.',
    pair3: 'Scan the QR code with this phone’s camera.',
    pptPairTitle: 'Connect to Ma3madan PPT', pptPair1: 'On the computer, open Ma3madan PPT.',
    installTitle: 'Install Ma3madan Remote', install: 'Install', installAndroid: 'One tap away on your home screen, and it connects by itself.', installIos: 'Tap {share} Share, then “Add to Home Screen”.',
    connecting: 'Connecting to {n}…', connectingText: 'The phone and the computer need the same Wi-Fi.',
    failedTitle: 'Couldn’t reach {n}', failedText: 'Open Ma3madan Play or Ma3madan PPT with the phone remote on.',
    pptFailedText: 'Make sure Ma3madan PPT is open on the computer with the phone remote turned on, and that both are on the same Wi-Fi.',
    noNet: 'No internet: connecting needs it for a moment. Once connected, the remote keeps working without it.',
    nearbyTitle: 'Computers on this Wi-Fi', nearbyNone: 'Looking…', nearbyTap: 'Tap to connect',
    pptNearbyNone: 'Looking… Ma3madan PPT must be open with the phone remote on.',
    orScan: 'Not there? Scan the QR code instead:',
    approveTitle: 'Approve on {n}', approveText: 'Check that it shows this code, then choose “Trust this device” (or “Just this time”).',
    deniedTitle: 'Not allowed', deniedText: '{n} didn’t allow this phone.', addComputer: 'Add',
    vocalRemover: 'Vocal remover', presetKaraoke: 'Karaoke', presetOriginal: 'Original', presetVocals: 'Vocals only', vocalsLabel: 'Vocals', musicLabel: 'Music',
    screensTitle: 'Screens', thisWindow: 'This window', allScreens: 'All screens', screenN: 'Screen {n}', fullscreen: 'Full screen',
    audioStandby: 'Standby screen for sound only',
    linkPh: 'Paste a YouTube link', paste: 'Paste', playNow: 'Play now', dlVideo: 'Download', sent: 'Sent ✓',
    countdown: 'Countdown', cdTitle: 'Countdown on the screen (minutes)', cdStop: 'Stop the countdown',
    karaoke: 'Karaoke', removeVocals: 'No vocals', separating: 'Separating… {n}%',
    speed: 'Speed', autoNext: 'Auto-play next', loop: 'Loop', subtitles: 'Subtitles', searchPh: 'Search videos',
    adding: 'Adding…', online: 'YouTube · online', dlFailed: 'Download failed', preparing: 'Preparing…',
    retry: 'Try again', forget: 'Forget this computer', connectedTo: 'Connected to {n}', notConnected: 'Not connected',
    viaRelay: 'through a relay', appClosed: '{a} isn’t open', appClosedTitle: '{a} isn’t open on {n}',
    appClosedText: 'Open it on the computer.',
    waitingTitle: 'Waiting for {n}…', waitingText: 'Turn the phone remote on in Ma3madan Play or Ma3madan PPT.',
    pptWaitingText: 'Turn the phone remote on in Ma3madan PPT.',
    unknownTitle: '{n} doesn’t know this phone any more', unknownText: 'Scan its code again.',
    upgradeNote: 'Scan the code on the computer again.',
    slidesTab: 'Ma3madan PPT',
    forgetQ: 'Forget “{n}”? You can pair again by scanning its code.',
    // Ma3madan PPT
    notPresenting: 'Not presenting', presenting: 'LIVE', blackOn: 'Black', whiteOn: 'White',
    noDeck: 'Open a presentation on the computer, or pick one below.',
    slideOf: 'Slide {n} of {c}', black: 'Black', white: 'White', end: 'End show', startShow: 'Start', fromStart: 'From the beginning',
    notes: 'Notes', noNotes: 'No notes on this slide', sections: 'Sections', slides: '{n} slides', oneSlide: '1 slide',
    presentations: 'Presentations', nextSlide: 'Next', openNow: 'Open', untitled: 'Untitled section', tapHint: 'Tap the slide to click on it',
    animStep: 'Animation {a} of {b}', endOfShow: 'End of the show',
  },
  ar: {
    standby: 'شاشة الانتظار', freeze: 'تثبيت', stop: 'إيقاف', lyrics: 'الكلمات', hide: 'إخفاء', marks: 'نقاط الفيديو', addHere: '+ هنا',
    next: 'التالي: ', nothing: 'لا يوجد تشغيل', live: 'مباشر', standbyOn: 'انتظار', paused: 'متوقف', videos: '{n} فيديو', recents: 'الأخيرة',
    pairTitle: 'اربط الموبايل بالكمبيوتر', pair1: 'افتح «معمدان بلاي» أو «معمدان بي بي تي» على الكمبيوتر.', pair2: 'اضغط زر الموبايل بالأعلى، ثم شغّل الريموت.',
    pair3: 'امسح الكود بكاميرا هذا الموبايل.',
    pptPairTitle: 'اربط الموبايل بمعمدان بي بي تي', pptPair1: 'افتح «معمدان بي بي تي» على الكمبيوتر.',
    installTitle: 'ثبّت Ma3madan Remote', install: 'تثبيت', installAndroid: 'على شاشتك الرئيسية بلمسة واحدة، ويتصل وحده.', installIos: 'اضغط {share} مشاركة، ثم «إضافة إلى الشاشة الرئيسية».',
    connecting: 'جارٍ الاتصال بـ {n}…', connectingText: 'يجب أن يكون الموبايل والكمبيوتر على نفس الواي فاي.',
    failedTitle: 'تعذّر الوصول إلى {n}', failedText: 'افتح «معمدان بلاي» أو «معمدان بي بي تي» وشغّل ريموت الموبايل.',
    pptFailedText: 'تأكد أن «معمدان بي بي تي» مفتوح على الكمبيوتر وريموت الموبايل يعمل، وأن الجهازين على نفس الواي فاي.',
    noNet: 'لا يوجد إنترنت: الاتصال يحتاجه للحظات فقط. بعد الاتصال يعمل الريموت بدونه.',
    nearbyTitle: 'أجهزة على هذا الواي فاي', nearbyNone: 'جارٍ البحث…', nearbyTap: 'اضغط للاتصال',
    pptNearbyNone: 'جارٍ البحث… يجب أن يكون «معمدان بي بي تي» مفتوحًا وريموت الموبايل يعمل.',
    orScan: 'ليس موجودًا؟ امسح الكود بدلًا من ذلك:',
    approveTitle: 'وافق على {n}', approveText: 'تأكد أنه يعرض نفس الرقم، ثم اختر «جهاز موثوق» (أو «هذه المرة فقط»).',
    deniedTitle: 'لم يُسمح', deniedText: '{n} لم يسمح لهذا الموبايل.', addComputer: 'إضافة',
    vocalRemover: 'إزالة الصوت', presetKaraoke: 'كاريوكي', presetOriginal: 'الأصلي', presetVocals: 'الغناء فقط', vocalsLabel: 'الغناء', musicLabel: 'الموسيقى',
    screensTitle: 'الشاشات', thisWindow: 'هذه النافذة', allScreens: 'كل الشاشات', screenN: 'شاشة {n}', fullscreen: 'ملء الشاشة',
    audioStandby: 'شاشة الانتظار مع الصوت فقط',
    linkPh: 'الصق رابط يوتيوب', paste: 'لصق', playNow: 'تشغيل الآن', dlVideo: 'تحميل', sent: 'تم ✓',
    countdown: 'عدّ تنازلي', cdTitle: 'عدّ تنازلي على الشاشة (بالدقائق)', cdStop: 'إيقاف العدّ',
    karaoke: 'كاريوكي', removeVocals: 'إزالة الصوت', separating: 'جارٍ الفصل… {n}%',
    speed: 'السرعة', autoNext: 'تشغيل التالي تلقائيًا', loop: 'تكرار', subtitles: 'الترجمة', searchPh: 'ابحث في الفيديوهات',
    adding: 'جارٍ الإضافة…', online: 'يوتيوب · أونلاين', dlFailed: 'فشل التحميل', preparing: 'جارٍ التجهيز…',
    retry: 'حاول مرة أخرى', forget: 'نسيان هذا الكمبيوتر', connectedTo: 'متصل بـ {n}', notConnected: 'غير متصل',
    viaRelay: 'عبر وسيط', appClosed: '{a} غير مفتوح', appClosedTitle: '{a} غير مفتوح على {n}',
    appClosedText: 'افتحه على الكمبيوتر.',
    waitingTitle: 'في انتظار {n}…', waitingText: 'شغّل ريموت الموبايل في «معمدان بلاي» أو «معمدان بي بي تي».',
    pptWaitingText: 'شغّل ريموت الموبايل في «معمدان بي بي تي».',
    unknownTitle: '{n} لم يعد يعرف هذا الموبايل', unknownText: 'امسح الكود مرة أخرى.',
    upgradeNote: 'امسح الكود من الكمبيوتر مرة أخرى.',
    slidesTab: 'Ma3madan PPT',
    forgetQ: 'نسيان «{n}»؟ يمكنك الربط مرة أخرى بمسح الكود.',
    notPresenting: 'لا يوجد عرض', presenting: 'مباشر', blackOn: 'أسود', whiteOn: 'أبيض',
    noDeck: 'افتح عرضًا على الكمبيوتر، أو اختر واحدًا بالأسفل.',
    slideOf: 'شريحة {n} من {c}', black: 'أسود', white: 'أبيض', end: 'إنهاء العرض', startShow: 'ابدأ', fromStart: 'من البداية',
    notes: 'الملاحظات', noNotes: 'لا توجد ملاحظات لهذه الشريحة', sections: 'الأقسام', slides: '{n} شريحة', oneSlide: 'شريحة واحدة',
    presentations: 'العروض', nextSlide: 'التالي', openNow: 'فتح', untitled: 'قسم بدون اسم', tapHint: 'اضغط على الشريحة للضغط عليها',
    animStep: 'حركة {a} من {b}', endOfShow: 'نهاية العرض',
  },
};
let lang = /^ar\b/i.test(navigator.language) ? 'ar' : 'en';
const t = (k, v = {}) => (S[lang][k] || S.en[k] || k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function setLang(l) {
  lang = S[l] ? l : 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  for (const el of document.querySelectorAll('[data-s]')) el.textContent = t(el.dataset.s);
  for (const el of document.querySelectorAll('[data-ph]')) el.placeholder = t(el.dataset.ph);
  for (const c of Object.values(conns)) c.renderLaptops();
}

// The name the computer shows for this phone. Browsers never give the phone's own name (the one
// Bluetooth shows); Android tells its model, and the computer can rename it.
let phoneModel = '';
navigator.userAgentData?.getHighEntropyValues?.(['model']).then(v => { phoneModel = (v.model || '').trim().slice(0, 24); }).catch(() => {});
function deviceName() {
  const ua = navigator.userAgent;
  if (phoneModel) return phoneModel;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'Phone';
}

// ---------- one connection to the computer, for both tabs ----------
// The computer has one link for its apps (Ma3madan Play and Ma3madan PPT, whichever are open), so
// the phone keeps one connection: each message names its app. The computers this phone may
// connect to (each gave it a key of its own) are in localStorage "computers".
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let computers = store.get('computers', []);
const saveComputers = () => store.set('computers', computers);
// Phones paired before the shared link (2026-10) had a key per app: those can't connect any more.
const hadOldPairs = () => (store.get('laptops', []).length || store.get('laptops-ppt', []).length) > 0;

const link = {
  current: null,     // the computer: { hostId, deviceId, key, name } (or { hostId, name, temp } from nearby / QR)
  state: 'idle',     // idle | connecting | approve | connected | failed | offline | unknown | denied
  pc: null, ctl: null, img: null, sock: null, attempt: 0, apps: [], route: null, code: '', error: null,
  retryTimer: null, lastHeard: 0,
};
const APP_NAMES = { play: 'Ma3madan Play', ppt: 'Ma3madan PPT' };

function linkClose() {
  clearTimeout(link.retryTimer); clearTimeout(link.relayTimer);
  link.relay = null; link.up = null;
  try { link.sock?.close(); } catch {}
  try { link.ctl?.close(); } catch {}
  try { link.img?.close(); } catch {}
  try { link.pc?.close(); } catch {}
  link.pc = link.ctl = link.img = link.sock = null;
}
// Before a connection there's one screen for both apps (the tabs show once connected).
const shownTab = () => (link.state === 'connected' ? currentTab : 'play');
function renderShell() {
  const linked = link.state === 'connected';
  document.querySelector('.tabs').hidden = !linked;
  document.body.classList.toggle('no-tabs', !linked);
  $('tab-play').hidden = shownTab() !== 'play';
  $('tab-slides').hidden = shownTab() !== 'ppt';
}
function setLinkState(state, extra = {}) {
  const was = link.state;
  Object.assign(link, { state }, extra);
  // Just connected: open the tab of an app that's open there.
  if (state === 'connected' && was !== 'connected' && link.apps.length && !link.apps.includes(currentTab)) currentTab = link.apps[0];
  renderShell();
  for (const v of Object.values(conns)) v.render();
}

// Connect to a computer. target: { computer } (known), { pair: { hostId, code, name } } (QR code),
// or { nearby: host } (from "Computers on this Wi-Fi", approved on the computer).
async function dial(target, { quiet = false } = {}) {
  linkClose();
  const my = ++link.attempt;
  const c = target.computer || (target.pair ? { hostId: target.pair.hostId, name: target.pair.name, temp: true } : { hostId: target.nearby.host, name: target.nearby.name, temp: true });
  link.current = c;
  if (target.computer) { c.at = Date.now(); computers = [c, ...computers.filter(x => x !== c)]; saveComputers(); }
  if (!(quiet && link.state === 'connected')) setLinkState('connecting', { error: null, code: '' });
  const live = () => my === link.attempt;
  try {
    const key = target.computer ? await MaLink.deviceKey(c.key) : target.pair ? await MaLink.pairKey(target.pair.code) : null;
    const pc = link.pc = new RTCPeerConnection({ iceServers: await MaLink.iceServers() });
    if (!live()) return;
    const ctl = link.ctl = pc.createDataChannel('ctl', { ordered: true });
    link.img = pc.createDataChannel('img', { ordered: true });
    wireChannels(ctl, link.img, c, target, my);
    pc.onconnectionstatechange = () => {
      if (link.pc !== pc) return;
      if (pc.connectionState === 'connected') MaLink.route(pc).then(r => { link.route = r; for (const v of Object.values(conns)) v.render(); });
      // No direct path while connecting: go through the room (startRelay) instead of failing.
      if (pc.connectionState === 'failed' && key && link.state !== 'connected') { startRelay(); return; }
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') lost(c);
    };
    // Network addresses go as they're found (no waiting): sealed like the offer.
    const out = [];
    const signal = async obj => {
      const msg = key ? { type: obj.type, box: await MaLink.seal(key, obj) } : { ...obj };
      if (target.computer) msg.dev = c.deviceId;
      if (target.pair) msg.pair = 1;
      if (target.nearby) msg.open = 1;
      if (link.sock?.open) link.sock.send(msg); else out.push(msg);
    };
    pc.onicecandidate = e => { if (e.candidate && live()) signal({ type: 'ice', c: e.candidate.toJSON() }); };
    await pc.setLocalDescription(await pc.createOffer());
    const offer = { type: 'offer', sdp: pc.localDescription.sdp, device: deviceName() };
    let remoteSet = false, sawHost = false; const early = [];
    const sent = new Promise((resolve, reject) => {
      link.sock = MaLink.socket({
        room: c.hostId, role: 'phone', peer: 'p-' + MaLink.randomId(9),
        onopen: async () => {
          if (!live()) return;
          await signal(offer); // goes first
          for (const m of out.splice(0)) link.sock.send(m);
          resolve();
        },
        onclose: () => {
          if (live() && link.state === 'connecting' && !remoteSet) reject(new Error('signal'));
          else if (live() && link.relay && link.state === 'connected') lost(c); // the relay itself is gone
        },
        onmessage: async m => {
          if (!live()) return;
          if (m.type === 'host') {
            // (The first one only says how the room was when this socket opened.)
            const first = !sawHost; sawHost = true;
            // The computer isn't there (off, or the remote is off): wait here, it may come.
            if (!m.online && !remoteSet) setLinkState('offline');
            else if (m.online && link.state === 'offline') dial(target, { quiet: true });
            // Connected, and the computer's room has a new holder (the other app took the link
            // over, or the app restarted): the old connection is gone, connect to the new one now.
            // (Only if the connection really is gone: the same app may just have reconnected.)
            else if (!first && m.online && link.state === 'connected' && link.current && !link.current.temp) {
              const asked = Date.now();
              linkSend({ type: 'ping' });
              setTimeout(() => { if (live() && link.state === 'connected' && link.lastHeard < asked) dial({ computer: link.current }, { quiet: true }); }, 1500);
            }
            return;
          }
          if (m.type === 'unknown') { setLinkState('unknown'); linkClose(); return; }
          if (m.type === 'r') {
            if (!key || !link.relay) return;
            try { const b = await MaLink.unseal(key, m.box); if (typeof b.d === 'string') link.relay.onmessage?.({ data: b.d }); } catch {}
            return;
          }
          let body = m;
          if (key && m.box) { try { body = await MaLink.unseal(key, m.box); } catch { return; } }
          if (body.type === 'answer' && typeof body.sdp === 'string' && !remoteSet) {
            remoteSet = true;
            if (body.name && body.name !== c.name) { c.name = body.name; if (!c.temp) saveComputers(); }
            await pc.setRemoteDescription({ type: 'answer', sdp: body.sdp });
            for (const x of early.splice(0)) pc.addIceCandidate(x).catch(() => {});
            if (target.nearby) {
              // The same 4 digits as on the computer: approve there.
              const code = await MaLink.sasCode(pc.localDescription.sdp, body.sdp);
              if (live()) setLinkState('approve', { code });
            }
          } else if (body.type === 'ice' && body.c) {
            if (remoteSet) pc.addIceCandidate(body.c).catch(() => {}); else early.push(body.c);
          }
        },
      });
    });
    // Through the computer's room, when there's no direct path (see relayChannel in link.js).
    const startRelay = async () => {
      if (!live() || !key || link.relay || link.ctl?.readyState === 'open' || !link.sock?.open) return;
      clearTimeout(link.relayTimer);
      // The direct channels are let go quietly (their "closed" isn't a lost connection).
      for (const ch of [ctl, link.img]) if (ch) { ch.onclose = null; ch.onmessage = null; }
      pc.onconnectionstatechange = null; link.pc = null;
      try { pc.close(); } catch {}
      const send = async d => link.sock?.send({ type: 'r', box: await MaLink.seal(key, { d }) });
      const rctl = MaLink.relayChannel(send), rimg = MaLink.relayChannel(send);
      link.relay = rctl; link.ctl = rctl; link.img = rimg; link.route = 'relay';
      wireChannels(rctl, rimg, c, target, my);
      link.sock.send({ type: 'r', box: await MaLink.seal(key, { o: 1 }) });
      link.up?.();
    };
    await sent;
    // Nearby: as long as it takes to approve; else a few seconds is plenty.
    // Up: the direct channel opens; or, after 4 s without it, the room carries the messages.
    await new Promise((ok, fail) => {
      link.up = ok;
      ctl.addEventListener('open', ok, { once: true });
      // (Tests: localStorage 'relay-now' goes through the room at once, 'direct-only' never does.)
      if (key && !store.get('direct-only', false)) link.relayTimer = setTimeout(startRelay, store.get('relay-now', false) ? 0 : 4000);
      setTimeout(() => fail(new Error('no channel')), target.nearby ? 120000 : 20000);
    });
  } catch (e) {
    if (!live()) return;
    if (link.state === 'offline') return; // waiting for the computer: it comes back by itself
    if (link.state === 'unknown' || link.state === 'denied') return; // already said why
    linkFailed(c, e);
  }
}

function wireChannels(ctl, img, c, target, my) {
  const live = () => my === link.attempt;
  let ready = !!target.computer; // a known computer: in at once; otherwise wait for "paired"/"welcome"
  const connected = () => {
    // The signaling socket stays open (it costs nothing while idle): it tells this phone at once
    // when the computer's link moves to the other app or comes back.
    link.lastHeard = Date.now();
    // Pictures asked for on a connection that's gone are asked for again.
    for (const m of [thumbs, pthumbs]) for (const [k, v] of m) if (v == null) m.delete(k);
    setLinkState('connected');
    if (navigator.vibrate) navigator.vibrate(20);
  };
  ctl.onmessage = e => {
    if (!live()) return;
    link.lastHeard = Date.now();
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'pong') return;
    if (m.type === 'paired' && typeof m.key === 'string' && typeof m.deviceId === 'string') {
      // Trusted: this phone's own key for this computer, kept from now on.
      const known = { hostId: m.hostId || c.hostId, deviceId: m.deviceId, key: m.key, name: m.name || c.name, at: Date.now() };
      computers = [known, ...computers.filter(x => x.hostId !== known.hostId)];
      saveComputers();
      try { localStorage.removeItem('laptops'); localStorage.removeItem('laptops-ppt'); } catch {}
      link.current = known;
      ready = true;
      return;
    }
    if (m.type === 'welcome') { ready = true; return; }
    if (m.type === 'denied') { setLinkState('denied'); linkClose(); return; }
    if (m.type === 'hello') {
      link.apps = Array.isArray(m.apps) ? m.apps : [];
      if (m.name && link.current) link.current.name = m.name;
      if (ready) connected();
      return;
    }
    if (m.type === 'apps') { link.apps = Array.isArray(m.apps) ? m.apps : []; renderShell(); for (const v of Object.values(conns)) v.render(); return; }
    if (m.type === 'state' && conns[m.app]) conns[m.app].onState(m.state);
    else if (m.type === 'thumb' && conns[m.app]) arrived(m);
  };
  const whole = MaLink.assembler();
  // Only real pictures are shown (nothing else can slip into the page through them).
  const PICTURE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const arrived = m => { const full = whole(m); if (full && conns[full.app] && typeof full.data === 'string' && full.data.length < 4e6 && PICTURE.test(full.data)) conns[full.app].onThumb(full); };
  img.onmessage = e => { if (!live()) return; link.lastHeard = Date.now(); let m; try { m = JSON.parse(e.data); } catch { return; } if (m.type === 'thumb') arrived(m); };
  ctl.onclose = () => { if (live()) lost(c); };
}

// Lost (computer closed, Wi-Fi changed, phone slept…): reconnect quietly, keeping the remote on
// screen meanwhile.
function lost(c) {
  if (link.current !== c || link.state === 'denied' || link.state === 'unknown') return;
  const was = link.state;
  linkClose();
  if (c.temp) { link.current = null; setLinkState(computers.length ? 'failed' : 'idle'); return; }
  if (was === 'connected') { link.retryTimer = setTimeout(() => dial({ computer: c }, { quiet: true }), 800); return; }
  linkFailed(c, new Error('closed'));
}
function linkFailed(c, e) {
  linkClose();
  if (c.temp) { link.current = null; setLinkState('idle'); return; }
  setLinkState('failed', { error: navigator.onLine === false || /signal|fetch|network/i.test(e?.message || '') ? 'noNet' : 'fail' });
  // Keep trying quietly every 10 s while the app is open.
  link.retryTimer = setTimeout(() => { if (link.current === c && document.visibilityState === 'visible') dial({ computer: c }, { quiet: true }); }, 10000);
}
function linkSend(msg) {
  if (link.state === 'connected' && link.ctl?.readyState === 'open') { link.ctl.send(JSON.stringify(msg)); return true; }
  return false;
}
// Heartbeat: the computer answers every ping. Nothing heard for 12 s: the connection is gone
// even if the phone hasn't noticed (it slept, the Wi-Fi changed): connect again.
setInterval(() => {
  if (link.state !== 'connected' || document.visibilityState !== 'visible') return;
  linkSend({ type: 'ping' });
  if (!LAN && Date.now() - link.lastHeard > 9000 && link.current && !link.current.temp) dial({ computer: link.current }, { quiet: true });
}, 4000);
function forgetComputer(c) {
  if (!c || !confirm(t('forgetQ', { n: c.name }))) return;
  computers = computers.filter(x => x !== c && x.hostId !== c.hostId);
  saveComputers();
  if (link.current === c || link.current?.hostId === c.hostId) { link.attempt++; linkClose(); link.current = null; }
  startLink();
}
function startLink() {
  if (LAN) lanStart();
  else if (computers.length) dial({ computer: computers[0] });
  else setLinkState('idle');
}

// ---------- the Wi-Fi page: this same app, served by the computer itself (no internet) ----------
// Opened from the computer's "No internet here?" QR code (lan.js in the apps): the messages are the
// same, carried by Server-Sent Events one way and small POSTs the other.
const LAN = location.protocol === 'http:' && /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(location.hostname);
function lanStart() {
  const c = { hostId: 'lan', name: location.hostname, lan: true };
  link.current = c;
  setLinkState('connecting');
  const es = new EventSource('/events');
  let peer = null;
  const my = ++link.attempt;
  es.addEventListener('peer', e => {
    peer = JSON.parse(e.data);
    // A stand-in for the data channels: sends go to the computer as POSTs.
    const ctl = { readyState: 'open', send: data => fetch('/msg?peer=' + encodeURIComponent(peer), { method: 'POST', body: data }).catch(() => {}), close() {} };
    const img = { close() {} };
    link.ctl = ctl; link.img = img;
    wireChannels(ctl, img, c, { computer: c }, my);
  });
  es.onmessage = e => link.ctl?.onmessage?.({ data: e.data });
  // EventSource reconnects by itself; meanwhile the remote stays on screen.
  es.onerror = () => { if (link.state === 'connected') for (const v of Object.values(conns)) v.render(); };
}

// ---------- one view per tab ----------
// kind 'play' uses the original element ids; 'ppt' prefixes them with "p-".
function makeConn(kind, { onState, onThumb, failedText, pairTitle }) {
  const P = kind === 'ppt' ? 'p-' : '';
  const q = id => $(P + id);
  const c = { kind, onState, onThumb, nearbyTimer: null };
  const visible = () => shownTab() === kind;
  c.send = msg => linkSend({ ...msg, app: kind });
  c.status = () => {
    const name = link.current?.name || '';
    if (link.state === 'connected') return link.apps.includes(kind) ? { on: true, sub: t('connectedTo', { n: name }) + (link.route === 'relay' ? ' · ' + t('viaRelay') : '') } : { on: false, sub: t('appClosed', { a: APP_NAMES[kind] }) };
    if (link.state === 'connecting' || link.state === 'approve') return { on: false, sub: t('connecting', { n: name }) };
    return { on: false, sub: t('notConnected') };
  };
  const screen = which => {
    for (const id of ['pairScreen', 'connectScreen', 'remoteUi']) q(id).hidden = id !== which;
    if (which === 'pairScreen' && visible()) c.searchNearby(); else c.stopNearby();
  };
  const connectScreen = ({ spin = false, code = '', title, text, retry = false, forget = false }) => {
    screen('connectScreen');
    q('spinner').hidden = !spin;
    q('approveCode').hidden = !code;
    q('approveCode').textContent = code;
    q('connTitle').textContent = title;
    q('connText').textContent = text;
    q('retryBtn').hidden = !retry;
    q('forgetBtn').hidden = !forget;
  };
  c.render = () => {
    const l = link.current, name = l?.name || '';
    c.renderLaptops();
    q('upgradeNote').hidden = !(hadOldPairs() && !computers.length);
    switch (link.state) {
      case 'idle': screen('pairScreen'); break;
      case 'connecting': connectScreen({ spin: true, title: t('connecting', { n: name }), text: t('connectingText') }); break;
      case 'approve': connectScreen({ code: link.code, title: t('approveTitle', { n: name }), text: t('approveText') }); break;
      case 'offline': connectScreen({ spin: true, title: t('waitingTitle', { n: name }), text: t('waitingText'), forget: !l?.temp }); break;
      case 'unknown': connectScreen({ title: t('unknownTitle', { n: name }), text: t('unknownText'), forget: true }); break;
      case 'denied':
        connectScreen({ title: t('deniedTitle'), text: t('deniedText', { n: name }) });
        setTimeout(() => { if (link.state === 'denied') { link.current = computers[0] || null; setLinkState(computers.length ? 'failed' : 'idle'); } }, 4000);
        break;
      case 'failed': connectScreen({ title: t('failedTitle', { n: name }), text: link.error === 'noNet' ? t('noNet') : t(failedText), retry: !!l, forget: !!l && !l.temp }); break;
      case 'connected':
        if (link.apps.includes(kind)) screen('remoteUi');
        else connectScreen({ title: t('appClosedTitle', { a: APP_NAMES[kind], n: name }), text: t('appClosedText', { a: APP_NAMES[kind] }) });
        break;
    }
    if (visible()) { renderStatus(); renderInstall(); }
  };
  c.renderLaptops = () => {
    const box = q('laptops');
    box.hidden = !computers.length || LAN;
    const cur = link.current;
    box.innerHTML = computers.map((l, i) => {
      const on = cur && l.hostId === cur.hostId;
      return `<button data-i="${i}" class="${on ? 'on' : ''}"><svg><use href="#i-laptop"/></svg><span dir="auto">${esc(l.name)}</span>${on ? `<i class="more" data-more="${i}" aria-label="${esc(t('forget'))}">⋯</i>` : ''}</button>`;
    }).join('') + `<button class="add" data-add>+ ${esc(t('addComputer'))}</button>`;
    for (const b of box.querySelectorAll('button[data-i]')) b.onclick = e => {
      const l = computers[Number(b.dataset.i)];
      if (e.target.closest('[data-more]')) { forgetComputer(l); return; }
      if (!(link.current?.hostId === l.hostId && link.state === 'connected')) dial({ computer: l });
    };
    box.querySelector('[data-add]').onclick = () => { link.attempt++; linkClose(); link.current = null; setLinkState('idle'); };
  };

  // ---------- nearby computers (no QR code) ----------
  c.searchNearby = async () => {
    clearTimeout(c.nearbyTimer);
    if (LAN) return;
    try {
      const hosts = await MaLink.nearby();
      if (q('pairScreen').hidden) return;
      const box = q('nearbyList');
      const key = JSON.stringify([hosts, lang]);
      if (box.dataset.key !== key) {
        box.dataset.key = key;
        box.innerHTML = hosts.map((h, i) => `<button data-i="${i}" data-host="${esc(h.host)}"><svg><use href="#i-laptop"/></svg><span dir="auto">${esc(h.name)}<small class="apps">${esc(h.apps.map(a => APP_NAMES[a]).filter(Boolean).join(' · '))}</small></span><small>${esc(t('nearbyTap'))}</small></button>`).join('');
        for (const b of box.querySelectorAll('button')) b.onclick = () => {
          const h = hosts[Number(b.dataset.i)];
          const known = computers.find(x => x.hostId === h.host);
          dial(known ? { computer: known } : { nearby: h });
        };
      }
      q('nearbyNone').hidden = !!hosts.length;
    } catch {}
    if (!q('pairScreen').hidden && visible()) c.nearbyTimer = setTimeout(c.searchNearby, 3000);
  };
  c.stopNearby = () => clearTimeout(c.nearbyTimer);

  q('retryBtn').onclick = () => link.current && dial(link.current.temp ? { computer: computers[0] } : { computer: link.current });
  q('forgetBtn').onclick = () => forgetComputer(computers.find(x => x.hostId === link.current?.hostId));
  c.resume = () => {
    if (kind !== 'play') return; // one connection: resume once
    if (link.current && !link.current.temp && !['connected', 'approve', 'unknown', 'denied'].includes(link.state)) dial({ computer: link.current }, { quiet: true });
    else if (link.state === 'connected' && Date.now() - link.lastHeard > 6000) dial({ computer: link.current }, { quiet: true });
  };
  return c;
}

const conns = {};
conns.play = makeConn('play', { onState: s => { st = s; at = Date.now(); render(); }, onThumb: m => { thumbs.set(m.id + ':' + m.v, m.data); applyThumb(m.id, m.v); }, failedText: 'failedText' });
conns.ppt = makeConn('ppt', { onState: s => { pst = s; pat = Date.now(); renderPpt(); }, onThumb: m => pptThumbArrived(m), failedText: 'pptFailedText' });

// A scanned QR code opens #pair=<computer id>.<pairing code>&name=<computer>: connect with it
// (the computer trusts this phone and gives it its own key), and take it out of the address.
// With the app already open in the browser, scanning only changes the address's # part.
function takePairLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  const pair = h.get('pair') || '';
  if (location.hash) history.replaceState(null, '', location.pathname);
  const m = /^([\w-]{8,48})\.([\w-]{8,64})$/.exec(pair);
  if (!m) return pair ? 'old' : null;
  const name = (h.get('name') || 'PC').slice(0, 40);
  // Already paired with this computer: just connect.
  const known = computers.find(x => x.hostId === m[1]);
  return known ? { computer: known } : { pair: { hostId: m[1], code: m[2], name } };
}
addEventListener('hashchange', () => {
  const target = takePairLink();
  if (target && target !== 'old') dial(target);
});

// ---------- header status: the visible tab's connection ----------
let currentTab = 'play';
function renderStatus() {
  const s = conns[shownTab()].status();
  $('dot').classList.toggle('on', !!s.on);
  $('whoSub').textContent = s.sub || '';
  $('status').hidden = shownTab() !== 'play' || !s.on;
}

// Back from the background (screen was off, another app was open), or back online: reconnect if needed.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') conns.play.resume(); });
// Another network (switched to a hotspot, or back to the Wi-Fi): check the connection at once
// and, if it's gone, connect again within a couple of seconds.
function recheck() {
  if (LAN) return;
  if (link.state !== 'connected') { conns.play.resume(); return; }
  const asked = Date.now();
  linkSend({ type: 'ping' });
  setTimeout(() => { if (link.state === 'connected' && link.lastHeard < asked && link.current && !link.current.temp) dial({ computer: link.current }, { quiet: true }); }, 2000);
}
addEventListener('online', recheck);
navigator.connection?.addEventListener?.('change', recheck);

// ---------- Ma3madan Play: the video remote ----------
let st = {}, at = 0;
const thumbs = new Map(); // "id:version" → data URL
function send(cmd) {
  if (conns.play.send({ type: 'cmd', cmd }) && navigator.vibrate) navigator.vibrate(12);
}
function applyThumb(id, v) {
  const el = document.querySelector(`#list li[data-id="${CSS.escape(id)}"] .th`);
  const data = thumbs.get(id + ':' + v);
  if (el && data) { el.style.backgroundImage = `url('${data}')`; el.innerHTML = ''; }
}

document.addEventListener('click', e => {
  const b = e.target.closest('#remoteUi [data-a]');
  if (b) send({ action: b.dataset.a });
});
let volTimer;
$('vol').addEventListener('input', e => { clearTimeout(volTimer); volTimer = setTimeout(() => send({ action: 'volume', v: e.target.value / 100 }), 60); $('volPct').textContent = e.target.value + '%'; });

function render() {
  if (st.lang && st.lang !== lang && currentTab === 'play') setLang(st.lang);
  $('title').textContent = st.title || t('nothing');
  $('next').textContent = st.next ? t('next') + st.next : '';
  $('playBtn').querySelector('use').setAttribute('href', st.paused === false ? '#i-pause' : '#i-play');
  $('blackBtn').classList.toggle('on', !!st.black);
  $('freezeBtn').classList.toggle('on', !!st.frozen);
  const status = $('status');
  status.className = 'status' + (st.loaded && !st.paused && !st.black ? ' live' : st.black ? ' standby' : '');
  status.textContent = st.loaded && !st.paused && !st.black ? t('live') : st.black ? t('standbyOn') : st.loaded ? t('paused') : '';
  renderStatus();
  if (document.activeElement !== $('vol')) { $('vol').value = Math.round((st.volume ?? 1) * 100); $('volPct').textContent = st.muted ? '—' : Math.round((st.volume ?? 1) * 100) + '%'; }
  $('muteBtn').querySelector('use').setAttribute('href', st.muted ? '#i-mute' : '#i-vol');
  $('listName').textContent = st.listName || t('recents');
  $('count').textContent = st.items ? t('videos', { n: st.items.length }) : '';
  const list = $('list');
  // Rebuild the list only when it changed (the state arrives several times a second while playing).
  const listKey = JSON.stringify([st.items, st.playingId, query, lang]);
  if (list.dataset.key !== listKey) {
    list.dataset.key = listKey;
    list.innerHTML = shownItems().map(it => `
      <li data-id="${esc(it.id)}" class="${it.id === st.playingId ? 'playing' : ''} ${it.missing ? 'missing' : ''}">
        <span class="th">${it.thumb ? '' : '<svg><use href="#i-music"/></svg>'}</span>
        <span class="t" dir="auto">${esc(it.loading ? t('adding') : it.title)}${it.online && !it.loading ? `<small class="sub">${esc(t('online'))}</small>` : ''}</span><span class="d">${it.duration ? fmt(it.duration) : ''}</span></li>`).join('');
    for (const li of list.querySelectorAll('li')) li.onclick = () => send({ action: 'play', id: li.dataset.id });
    // Thumbnails come over the same connection, once each.
    for (const it of st.items || []) {
      if (!it.thumb) continue;
      if (thumbs.has(it.id + ':' + it.thumb)) applyThumb(it.id, it.thumb);
      else if (conns.play.send({ type: 'thumb', id: it.id, v: it.thumb })) thumbs.set(it.id + ':' + it.thumb, null);
    }
  }
  const slides = st.lyrics?.slides || [];
  $('lyricsBox').hidden = !slides.length;
  const lk = JSON.stringify(st.lyrics);
  if ($('lyrics').dataset.key !== lk) {
    $('lyrics').dataset.key = lk;
    $('lyrics').innerHTML = slides.map((s, i) => `<button data-i="${i}" class="${st.lyrics.current === i ? 'on' : ''}" dir="auto">${esc(s)}</button>`).join('');
    for (const b of $('lyrics').querySelectorAll('button')) b.onclick = () => send({ action: 'lyric', i: Number(b.dataset.i) });
  }
  // Checkpoints of the playing video: tap to jump there.
  const marks = st.marks?.list || [];
  $('marksBox').hidden = !st.loaded;
  const mk = JSON.stringify([st.marks, st.duration]);
  if ($('marks').dataset.key !== mk) {
    $('marks').dataset.key = mk;
    $('marks').innerHTML = marks.map((m, i) => `<button data-i="${i}" class="${st.marks.current === i ? 'on' : ''}"><b>${fmt(m.t)}</b><span dir="auto">${esc(m.label)}</span></button>`).join('');
    for (const b of $('marks').querySelectorAll('button')) b.onclick = () => send({ action: 'mark', i: Number(b.dataset.i) });
    $('ticks').innerHTML = st.duration ? marks.map(m => `<i style="left:${(m.t / st.duration) * 100}%"></i>`).join('') : '';
  }
  renderMore();
  tickTime();
}
function tickTime() {
  const now = (st.time || 0) + (st.loaded && !st.paused && !st.buffering ? (Date.now() - at) / 1000 * (st.rate || 1) : 0);
  const d = st.duration || 0;
  $('cur').textContent = fmt(Math.min(now, d || now));
  $('dur').textContent = fmt(d);
  if (!dragging) { $('seek').value = d ? Math.round(Math.min(1, now / d) * 1000) : 0; $('seek').style.setProperty('--p', $('seek').value / 10 + '%'); }
}
// The time bar: drag (or tap) to move in the video.
let dragging = false;
$('seek').addEventListener('input', e => {
  dragging = true;
  e.target.style.setProperty('--p', e.target.value / 10 + '%');
  $('cur').textContent = fmt((e.target.value / 1000) * (st.duration || 0));
});
$('seek').addEventListener('change', e => {
  const time = (e.target.value / 1000) * (st.duration || 0);
  if (st.duration) { send({ action: 'seek', t: time }); st.time = time; at = Date.now(); }
  dragging = false;
});
setInterval(tickTime, 250);

// ---------- Ma3madan PPT: the PowerPoint remote ----------
let pst = {}, pat = 0;
const pthumbs = new Map(); // "n|size|path:version" → data URL (null while asked for)
const openSecs = new Set(); // sections opened in the list
const openGroups = new Set(['open']);
function psend(cmd) {
  if (conns.ppt.send({ type: 'cmd', cmd }) && navigator.vibrate) navigator.vibrate(12);
}
// Slide pictures come over the connection once each; the version changes with the file.
function pthumb(n, size, deck = pst.deck) {
  if (!deck || n > (deck.ready || 0)) return null;
  const id = `${n}|${size}|${deck.path}`;
  const k = id + ':' + deck.v;
  if (pthumbs.has(k)) return pthumbs.get(k);
  if (conns.ppt.send({ type: 'thumb', id, v: deck.v })) pthumbs.set(k, null);
  return null;
}
function pptThumbArrived(m) {
  pthumbs.set(m.id + ':' + m.v, m.data);
  for (const el of document.querySelectorAll(`[data-th="${CSS.escape(m.id)}"]`)) el.style.backgroundImage = `url('${m.data}')`;
  if ($('pSlideImg').dataset.id === m.id) $('pSlideImg').src = m.data;
}

const showOf = () => (pst.show?.running ? pst.show : null);
let fullEndTimer = null;
function renderPpt() {
  if (pst.lang && pst.lang !== lang && currentTab === 'ppt') setLang(pst.lang);
  const s = showOf(), d = pst.deck;
  // The slide on the projector (or, before the show, the presentation on the computer's screen).
  const live = s && d && d.path === s.path;
  $('pDeck').textContent = d ? d.name : t('notPresenting');
  const st2 = $('pStatus');
  st2.className = 'status' + (live ? (s.state === 3 || s.state === 4 ? ' standby' : ' live') : '');
  st2.textContent = live ? (s.state === 3 ? t('blackOn') : s.state === 4 ? t('whiteOn') : t('presenting')) : t('notPresenting');
  const n = live ? s.slide : 1;
  const box = $('pSlide');
  if (d) box.style.setProperty('--r', String(d.ratio));
  box.classList.toggle('live', !!live);
  box.classList.toggle('dark', !!live && s.state === 3);
  box.classList.toggle('light', !!live && s.state === 4);
  const img = $('pSlideImg');
  if (d && n) {
    const id = `${n}|big|${d.path}`;
    img.dataset.id = id;
    const data = pthumb(n, 'big');
    if (data) img.src = data; else img.removeAttribute('src');
  } else { img.removeAttribute('src'); img.dataset.id = ''; }
  $('pEmpty').hidden = !!d;
  const secs = d?.sections || [];
  const sec = live ? secs.find(x => n >= x.first && n < x.first + x.count) : null;
  $('pPos').textContent = live ? t('slideOf', { n: s.slide, c: s.count }) : d ? t('slides', { n: d.slides.length }) : '';
  $('pSec').textContent = sec?.name || '';
  $('pStep').textContent = live && s.clicks ? t('animStep', { a: s.click, b: s.clicks }) : '';
  $('pHint').hidden = !live;
  // Buttons
  $('pPlayRow').hidden = !live;
  $('pStartRow').hidden = !!live || !d;
  $('pBlackBtn').classList.toggle('on', !!live && s.state === 3);
  $('pWhiteBtn').classList.toggle('on', !!live && s.state === 4);
  $('pControls').hidden = !live;
  // Notes
  $('pNotesBox').hidden = !live;
  $('pNotes').textContent = pst.notes || t('noNotes');
  $('pNotes').classList.toggle('empty', !pst.notes);
  // The next slide's big picture comes ahead, so moving on shows it at once.
  if (live && n < d.slides.length) pthumb(n + 1, 'big');
  $('pFullPos').textContent = live ? `${s.slide} / ${s.count}` : '';
  $('pStagePos').textContent = live ? t('slideOf', { n: s.slide, c: s.count }) : '';
  $('pStageSec').textContent = sec?.name || '';
  // Full screen closes by itself only when the show has really ended (PowerPoint reports a
  // moment between slides that looks like "not running"); else only ✕ or Back close it.
  clearTimeout(fullEndTimer);
  if (!live && document.body.classList.contains('pfull')) fullEndTimer = setTimeout(() => { if (!showOf()) setFull(false); }, 2000);
  renderPptSections(d, live ? n : 0);
  renderPptDecks();
  renderStatus();
  tickPptTimer();
}

function renderPptSections(d, cur) {
  const box = $('pSections');
  $('pSectionsHead').hidden = !d;
  if (!d) { box.innerHTML = ''; box.dataset.key = ''; return; }
  const secs = d.sections.length ? d.sections : [{ name: '', first: 1, count: d.slides.length }];
  const key = JSON.stringify([d.path, d.v, d.ready, secs, cur, [...openSecs], showOf()?.path]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const live = showOf() && showOf().path === d.path;
  box.innerHTML = secs.map((sec, i) => {
    const k = d.path + '|' + i;
    const here = cur >= sec.first && cur < sec.first + sec.count;
    const open = openSecs.has(k) || (secs.length === 1 && !secs[0].name);
    let slides = '';
    if (open) {
      for (let n = sec.first; n < sec.first + sec.count; n++) {
        const sl = d.slides[n - 1] || {};
        const data = pthumb(n, 'small', d);
        slides += `<button class="pslide ${n === cur ? 'cur' : ''} ${sl.h ? 'hid' : ''}" data-n="${n}"><span class="pic" data-th="${esc(`${n}|small|${d.path}`)}" ${data ? `style="background-image:url('${data}')"` : ''}><i>${n}</i></span><span class="cap" dir="auto">${esc(sl.t || '')}</span></button>`;
      }
    }
    return `<div class="psec ${open ? 'open' : ''} ${here ? 'here' : ''}">
      ${secs.length > 1 || sec.name ? `<button class="psec-head" data-k="${esc(k)}"><svg class="caret"><use href="#i-caret"/></svg><b dir="auto">${esc(sec.name || t('untitled'))}</b><small>${esc(sec.count === 1 ? t('oneSlide') : t('slides', { n: sec.count }))}</small>
        <span class="go" data-go="${sec.first}"><svg><use href="#i-play"/></svg></span></button>` : ''}
      ${open ? `<div class="pslides" style="--r:${d.ratio}">${slides}</div>` : ''}
    </div>`;
  }).join('');
  for (const h of box.querySelectorAll('.psec-head')) h.onclick = e => {
    const go = e.target.closest('[data-go]');
    if (go) { psend(live ? { action: 'go', n: Number(go.dataset.go) } : { action: 'go', n: Number(go.dataset.go), path: d.path }); return; }
    openSecs.has(h.dataset.k) ? openSecs.delete(h.dataset.k) : openSecs.add(h.dataset.k);
    renderPpt();
  };
  for (const b of box.querySelectorAll('.pslide')) b.onclick = () => psend(live ? { action: 'go', n: Number(b.dataset.n) } : { action: 'go', n: Number(b.dataset.n), path: d.path });
}

function renderPptDecks() {
  const box = $('pDecks');
  const groups = [];
  if (pst.open?.length) groups.push({ id: 'open', name: t('presentations'), items: pst.open });
  if (pst.recents?.length) groups.push({ id: 'recents', name: t('recents'), items: pst.recents });
  for (const [i, l] of (pst.lists || []).entries()) groups.push({ id: 'list' + i, name: l.name, items: l.items });
  const key = JSON.stringify([groups, [...openGroups], pst.active, showOf()?.path]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const livePath = showOf()?.path;
  box.innerHTML = groups.map(g => {
    const open = openGroups.has(g.id);
    return `<div class="pgroup ${open ? 'open' : ''}"><button class="pgroup-head" data-g="${g.id}"><svg class="caret"><use href="#i-caret"/></svg><b dir="auto">${esc(g.name)}</b><small>${g.items.length}</small></button>
      ${open ? `<ul>${g.items.map(it => `<li class="${it.path === livePath ? 'playing' : it.path === pst.active ? 'active' : ''}" data-path="${esc(it.path)}"><svg><use href="#i-slides"/></svg><span class="t" dir="auto">${esc(it.name)}</span>
        <button class="pstart" data-start="${esc(it.path)}" aria-label="${esc(t('startShow'))}"><svg><use href="#i-play"/></svg></button></li>`).join('')}</ul>` : ''}</div>`;
  }).join('');
  for (const h of box.querySelectorAll('.pgroup-head')) h.onclick = () => { openGroups.has(h.dataset.g) ? openGroups.delete(h.dataset.g) : openGroups.add(h.dataset.g); renderPpt(); };
  for (const li of box.querySelectorAll('li')) li.onclick = e => {
    const st0 = e.target.closest('[data-start]');
    psend(st0 ? { action: 'start', path: st0.dataset.start, n: 1 } : { action: 'open', path: li.dataset.path });
  };
}

// The show's timer, counted here between updates.
function tickPptTimer() {
  const tm = pst.timer;
  const live = !!showOf();
  $('pTimer').hidden = !live || !tm;
  if (!live || !tm) return;
  // The computer sends how long it has run (clocks differ): count on from there unless paused.
  $('pTimer').textContent = fmt((tm.elapsed + (tm.running ? Date.now() - pat : 0)) / 1000);
}
setInterval(tickPptTimer, 500);

// Tap on the slide: the same spot on the projector (links, buttons, videos, triggers).
// Swipe left or right on the slide: next or back. A tap stays a click on the projector.
let touch = null, swiped = 0;
// Full screen with the phone upright, the slide is turned sideways (body.rot): finger positions
// are turned back into the slide's own directions.
const turned = () => document.body.classList.contains('rot');
// The slide may be turned twice: full screen on an upright phone (+90°), and the whole app turned
// back when the phone is held sideways (−angle). Finger positions are turned back into the slide.
function onSlide(x, y) {
  const el = $('pSlide'), b = el.getBoundingClientRect();
  const deg = (turned() ? 90 : 0) - uprightAngle, t = deg * Math.PI / 180;
  if (deg % 360 === 0) return { x: x - b.left, y: y - b.top, w: b.width, h: b.height };
  const w = el.offsetWidth, h = el.offsetHeight, dx = x - (b.left + b.width / 2), dy = y - (b.top + b.height / 2);
  return { x: dx * Math.cos(t) + dy * Math.sin(t) + w / 2, y: -dx * Math.sin(t) + dy * Math.cos(t) + h / 2, w, h };
}
$('pSlide').addEventListener('touchstart', e => { if (e.touches.length === 1) touch = onSlide(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
$('pSlide').addEventListener('touchend', e => {
  if (!touch || !showOf()) return;
  const end = onSlide(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  const dx = end.x - touch.x, dy = end.y - touch.y;
  touch = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) { swiped = Date.now(); psend({ action: dx < 0 ? 'next' : 'prev' }); }
});
// Full screen: only the slide. The phone's Back button (or ✕) brings the remote back.
let fullBy = null, fullHistory = false;
const isFull = () => document.body.classList.contains('pfull');
const portrait = () => matchMedia('(orientation: portrait)').matches;
// ---------- the app stays upright on the phone ----------
// Browsers don't let a page lock the screen's orientation. So when a phone is held sideways (and
// the browser turns the page), the whole app (#app) is turned back the other way: it stays upright
// on the phone, clear of the phone's bars, and full screen always looks the same.
let uprightAngle = 0;
function screenAngle() {
  if (typeof store.get('test-angle', null) === 'number') return store.get('test-angle', 0); // tests
  const a = screen.orientation ? screen.orientation.angle : (window.orientation || 0);
  return ((a % 360) + 360) % 360;
}
const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600 || store.get('test-angle', null) !== null;
function safeInsets() {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(p);
  const c = getComputedStyle(p), r = { t: parseFloat(c.paddingTop) || 0, r: parseFloat(c.paddingRight) || 0, b: parseFloat(c.paddingBottom) || 0, l: parseFloat(c.paddingLeft) || 0 };
  p.remove();
  return r;
}
function applyUpright() {
  const a = isPhone() ? screenAngle() : 0;
  uprightAngle = a === 90 || a === 270 ? a : 0;
  const on = !!uprightAngle, root = document.documentElement.style;
  document.body.classList.toggle('upright', on);
  if (!on) { for (const k of ['--st', '--sb', '--sl', '--sr']) root.removeProperty(k); return null; }
  const vv = window.visualViewport, vw = vv?.width || innerWidth, vh = vv?.height || innerHeight, ins = safeInsets();
  const w = Math.floor(vh - ins.t - ins.b), h = Math.floor(vw - ins.l - ins.r); // the app's upright size
  root.setProperty('--uw', w + 'px'); root.setProperty('--uh', h + 'px');
  root.setProperty('--ucx', (ins.l + (vw - ins.l - ins.r) / 2) + 'px'); root.setProperty('--ucy', (ins.t + (vh - ins.t - ins.b) / 2) + 'px');
  root.setProperty('--urot', -uprightAngle + 'deg');
  // Inside the turned app the edges are already clear of the bars.
  for (const k of ['--st', '--sb', '--sl', '--sr']) root.setProperty(k, '0px');
  return { w, h };
}
function applyTurn() {
  // Full screen on an upright phone: the slide turned sideways so it's wide and readable. Sized to
  // the part of the screen really visible now (CSS's 100vh/100vw count the status and browser bars
  // on some phones, which cut the turned slide's bottom off).
  const up = applyUpright();
  const vv = window.visualViewport, root = document.documentElement.style;
  root.setProperty('--vw', (up ? up.w : Math.floor(vv?.width || innerWidth)) + 'px');
  root.setProperty('--vh', (up ? up.h : Math.floor(vv?.height || innerHeight)) + 'px');
  document.body.classList.toggle('rot', isFull() && (up ? true : portrait()));
  setTimeout(measureHeader, 0);
}
function setFull(on, by = 'button') {
  if (!!on === isFull()) return;
  document.body.classList.toggle('pfull', !!on);
  // The phone's top bar turns black to blend with the slide's background (hiding it needs the
  // browser's own full screen, which shows its "drag to exit" message every time).
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#000000' : '#0b1120');
  if (on) {
    fullBy = by;
    // An entry in the history, so Back closes full screen instead of leaving the app.
    // (The page fills the screen by itself: asking the browser for full screen would bring its
    // "drag to exit full screen" message every time.)
    if (!fullHistory) { history.pushState({ pfull: 1 }, ''); fullHistory = true; }
  } else {
    fullBy = null;
    closeTree();
    if (fullHistory) { fullHistory = false; if (history.state?.pfull) history.back(); }
  }
  applyTurn();
}
addEventListener('popstate', () => { if (fullHistory) { fullHistory = false; setFull(false); } });
addEventListener('resize', applyTurn);
// The app stays upright: the installed app is locked by its manifest; this asks the phone too
// (some allow it without reinstalling). Full screen shows the slide sideways by itself.
const lockUpright = () => { try { screen.orientation?.lock?.('portrait').catch(() => {}); } catch {} };
lockUpright();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lockUpright(); });
window.visualViewport?.addEventListener('resize', applyTurn);
screen.orientation?.addEventListener?.('change', () => setTimeout(applyTurn, 50));
addEventListener('orientationchange', () => setTimeout(applyTurn, 50));
applyTurn();
$('pFullBtn').onclick = e => { e.stopPropagation(); setFull(true); };
$('pFullClose').onclick = e => { e.stopPropagation(); setFull(false); };
// Turning the phone never opens or closes full screen (only the button does), and in full screen
// the slide and its buttons stay together the same way round.
$('pSlide').addEventListener('click', e => {
  if (!showOf() || Date.now() - swiped < 600 || e.target.closest('button')) return;
  // Where on the slide itself: full screen, the slide sits letterboxed in the phone's screen.
  const p = onSlide(e.clientX, e.clientY), ratio = pst.deck?.ratio || p.w / p.h;
  let w = p.w, h = w / ratio;
  if (h > p.h) { h = p.h; w = h * ratio; }
  const sx = (p.x - (p.w - w) / 2) / w, sy = (p.y - (p.h - h) / 2) / h;
  if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return;
  psend({ action: 'click', sx, sy });
  // A ripple where the finger was.
  const dot = document.createElement('i');
  dot.className = 'tap';
  dot.style.left = p.x + 'px'; dot.style.top = p.y + 'px';
  $('pSlide').appendChild(dot);
  setTimeout(() => dot.remove(), 600);
});
document.addEventListener('click', e => {
  const b = e.target.closest('#p-remoteUi [data-p]');
  if (b) psend({ action: b.dataset.p });
});
$('pStartBtn').onclick = () => pst.deck && psend({ action: 'start', path: pst.deck.path, n: 1 });

// ---------- the sections tree: every section with its slides, tap one to go there ----------
const treeOpen = new Set();
function openTree(fresh = false) {
  const d = pst.deck;
  if (!d) return;
  if (fresh) { treeOpen.clear(); gridOpen.clear(); }
  if (isFull()) { openGrid(d); return; }
  $('pTree').classList.remove('grid');
  const s = showOf(), live = s && s.path === d.path, cur = live ? s.slide : 0;
  const secs = d.sections.length ? d.sections : [{ name: '', first: 1, count: d.slides.length }];
  const here = secs.findIndex(x => cur >= x.first && cur < x.first + x.count);
  if (secs.length === 1 && !secs[0].name) treeOpen.add(d.path + '|0'); // no sections: just the slides
  $('pTreeDeck').textContent = d.name;
  $('pTreeList').innerHTML = secs.map((sec, i) => {
    const k = d.path + '|' + i, open = treeOpen.has(k);
    let rows = '';
    if (open) for (let n = sec.first; n < sec.first + sec.count; n++) {
      const sl = d.slides[n - 1] || {}, pic = pthumb(n, 'small', d);
      rows += `<button class="ptree-slide ${n === cur ? 'cur' : ''} ${sl.h ? 'hid' : ''}" data-n="${n}"><i>${n}</i><b class="th" ${pic ? `style="background-image:url('${pic}')"` : ''}></b><span dir="auto">${esc(sl.t || '')}</span></button>`;
    }
    return `<div class="ptree-sec ${open ? 'open' : ''} ${i === here ? 'here' : ''}">${secs.length > 1 || sec.name ? `<button data-k="${esc(k)}"><svg class="caret"><use href="#i-caret"/></svg><b dir="auto">${esc(sec.name || t('untitled'))}</b><small>${sec.count}</small></button>` : ''}${open ? `<div class="ptree-slides">${rows}</div>` : ''}</div>`;
  }).join('');
  for (const b of $('pTreeList').querySelectorAll('[data-k]')) b.onclick = () => { treeOpen.has(b.dataset.k) ? treeOpen.delete(b.dataset.k) : treeOpen.add(b.dataset.k); openTree(); };
  for (const b of $('pTreeList').querySelectorAll('[data-n]')) b.onclick = () => {
    psend(live ? { action: 'go', n: Number(b.dataset.n) } : { action: 'go', n: Number(b.dataset.n), path: d.path });
    closeTree();
  };
  const wasHidden = $('pTree').hidden;
  $('pTree').hidden = false;
  if (wasHidden) $('pTreeList').querySelector('.cur')?.scrollIntoView({ block: 'center' });
}
function closeTree() { $('pTree').hidden = true; }
const gridOpen = new Set(); // sections opened in the full-screen grid
function openGrid(d) {
  const s = showOf(), live = s && s.path === d.path, cur = live ? s.slide : 0;
  const secs = d.sections.length ? d.sections : [{ name: '', first: 1, count: d.slides.length }];
  const here = secs.findIndex(x => cur >= x.first && cur < x.first + x.count);
  const named = secs.length > 1 || secs[0].name;
  if (!named) gridOpen.add(0); // no sections: just the slides
  $('pTree').classList.add('grid');
  $('pTreeDeck').textContent = d.name;
  const keepScroll = $('pTreeList').querySelector('.pg-main')?.scrollTop || 0;
  $('pTreeList').innerHTML = (named ? `<nav class="pg-secs">${secs.map((sec, i) => `<button data-sec="${i}" class="${i === here ? 'here' : ''} ${gridOpen.has(i) ? 'open' : ''}"><b dir="auto">${esc(sec.name || t('untitled'))}</b><small>${esc(sec.count === 1 ? t('oneSlide') : t('slides', { n: sec.count }))}</small></button>`).join('')}</nav>` : '')
    + `<div class="pg-main" style="--r:${d.ratio}">${secs.map((sec, i) => {
      const open = gridOpen.has(i);
      let tiles = '';
      if (open) for (let n = sec.first; n < sec.first + sec.count; n++) {
        const sl = d.slides[n - 1] || {}, pic = pthumb(n, 'small', d);
        tiles += `<button class="pg-tile ${n === cur ? 'cur' : ''} ${sl.h ? 'hid' : ''}" data-n="${n}"><span class="pg-pic" ${pic ? `style="background-image:url('${pic}')"` : ''}></span><span class="pg-num">${n}</span></button>`;
      }
      const head = named ? `<button class="pg-head ${i === here ? 'here' : ''}" data-toggle="${i}"><svg class="caret"><use href="#i-caret"/></svg><b dir="auto">${esc(sec.name || t('untitled'))}</b><small>${sec.count}</small></button>` : '';
      return `<section class="pg-sec ${open ? 'open' : ''}" id="pg-sec-${i}">${head}${open ? `<div class="pg-tiles">${tiles}</div>` : ''}</section>`;
    }).join('')}</div>`;
  const main = $('pTreeList').querySelector('.pg-main');
  main.scrollTop = keepScroll;
  const toggle = i => { gridOpen.has(i) ? gridOpen.delete(i) : gridOpen.add(i); openGrid(d); };
  for (const b of $('pTreeList').querySelectorAll('[data-toggle]')) b.onclick = () => toggle(Number(b.dataset.toggle));
  // A section on the side: open it and go to it.
  for (const b of $('pTreeList').querySelectorAll('[data-sec]')) b.onclick = () => {
    const i = Number(b.dataset.sec);
    gridOpen.add(i); openGrid(d);
    const m = $('pTreeList').querySelector('.pg-main');
    m.scrollTo({ top: $('pg-sec-' + i).offsetTop - m.offsetTop, behavior: 'smooth' });
  };
  for (const b of $('pTreeList').querySelectorAll('[data-n]')) b.onclick = () => {
    psend(live ? { action: 'go', n: Number(b.dataset.n) } : { action: 'go', n: Number(b.dataset.n), path: d.path });
    closeTree();
  };
  $('pTree').hidden = false;
}
document.addEventListener('click', e => { if (e.target.closest('[data-tree]')) { e.stopPropagation(); openTree(true); } });
$('pTreeClose').onclick = closeTree;
$('pTree').addEventListener('click', e => { if (e.target === $('pTree')) closeTree(); });

// ---------- more of the app on the phone ----------
let query = '';
const shownItems = () => {
  const q = query.trim().toLowerCase();
  return (st.items || []).filter(it => !q || it.title.toLowerCase().includes(q));
};
$('searchInput').addEventListener('input', e => { query = e.target.value; render(); });

// A YouTube link: Play now (online), or download it to the computer.
const isLink = v => /^https?:\/\/\S+\.\S+/i.test(v.trim());
function renderLinkActions() { $('linkActions').hidden = !isLink($('linkInput').value); }
$('linkInput').addEventListener('input', renderLinkActions);
$('pasteBtn').onclick = async () => {
  try { $('linkInput').value = (await navigator.clipboard.readText()).trim(); } catch { $('linkInput').focus(); }
  renderLinkActions();
};
for (const [id, mode] of [['linkPlay', 'stream'], ['linkVideo', 'video'], ['linkMp3', 'mp3']]) {
  $(id).onclick = () => {
    const url = $('linkInput').value.trim();
    if (!isLink(url)) return;
    send({ action: 'link', url, mode });
    const b = $(id), label = b.querySelector('span'), old = label.textContent;
    b.classList.add('sent'); label.textContent = t('sent');
    setTimeout(() => { b.classList.remove('sent'); label.textContent = old; $('linkInput').value = ''; renderLinkActions(); }, 1200);
  };
}

// Countdown: pick the minutes; tap again to stop it.
$('cdBtn').onclick = () => { $('cdPanel').hidden = !$('cdPanel').hidden; };
for (const b of document.querySelectorAll('#cdPanel [data-min]')) b.onclick = () => { send({ action: 'countdown', minutes: Number(b.dataset.min) }); $('cdPanel').hidden = true; };
$('cdStop').onclick = () => { send({ action: 'countdown', minutes: 0 }); $('cdPanel').hidden = true; };

for (const b of document.querySelectorAll('#speedSeg button')) b.onclick = () => send({ action: 'speed', r: Number(b.dataset.r) });
$('autoNextBtn').onclick = () => send({ action: 'autoNext', on: !st.autoNext });
$('loopBtn').onclick = () => send({ action: 'loop', on: !st.loop });
$('subsBtn').onclick = () => send({ action: 'subs', on: !st.subsOn });

// ---------- vocal remover mixer, screens, full screen ----------
const PRESETS = { karaoke: { music: 1, vocals: 0 }, original: { music: 1, vocals: 1 }, vocals: { music: 0, vocals: 1 } };
let mixTimer = null, mixDragging = false;
function sendMix() {
  clearTimeout(mixTimer);
  mixTimer = setTimeout(() => send({ action: 'mix', music: $('mixMusic').value / 100, vocals: $('mixVocals').value / 100 }), 80);
}
for (const id of ['mixVocals', 'mixMusic']) {
  $(id).addEventListener('input', () => { mixDragging = true; $(id + 'Pct').textContent = $(id).value + '%'; sendMix(); });
  $(id).addEventListener('change', () => { mixDragging = false; });
}
for (const b of document.querySelectorAll('#mixPresets button')) b.onclick = () => send({ action: 'mix', ...PRESETS[b.dataset.p] });
$('fullBtn').onclick = () => send({ action: 'fullscreen' });
$('audioStandbyBtn').onclick = () => send({ action: 'audioStandby', on: !st.audioStandby });

function renderMixAndScreens() {
  const m = st.mix;
  $('mixCard').hidden = !m;
  if (m) {
    for (const [id, k] of [['mixVocals', 'vocals'], ['mixMusic', 'music']]) {
      if (!mixDragging) $(id).value = Math.round(m[k] * 100);
      $(id + 'Pct').textContent = Math.round(m[k] * 100) + '%';
    }
    for (const b of document.querySelectorAll('#mixPresets button')) {
      const p = PRESETS[b.dataset.p];
      b.classList.toggle('on', Math.abs(p.music - m.music) < 0.01 && Math.abs(p.vocals - m.vocals) < 0.01);
    }
  }
  // Screens: "This window", each other screen, "All screens"; full screen in the window.
  const screens = st.screens || [];
  const others = screens.filter(x => !x.here);
  const key = JSON.stringify([screens, st.mode, lang]);
  const box = $('screenChips');
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    const inWindow = st.mode !== 'presenter';
    const all = others.length && others.every(x => x.on) && screens.some(x => x.here && x.on);
    box.innerHTML = [
      `<button class="tog ${inWindow ? 'on' : ''}" data-q="window">${esc(t('thisWindow'))}</button>`,
      ...others.map(x => `<button class="tog ${x.on ? 'on' : ''}" data-id="${x.id}">${esc(t('screenN', { n: x.n }))}</button>`),
      ...(others.length ? [`<button class="tog ${all ? 'on' : ''}" data-q="all">${esc(t('allScreens'))}</button>`] : []),
    ].join('');
    for (const b of box.querySelectorAll('button')) b.onclick = () => send(b.dataset.q ? { action: 'screens', q: b.dataset.q } : { action: 'screens', id: Number(b.dataset.id) });
  }
  $('fullBtn').hidden = st.mode === 'presenter';
  $('fullBtn').classList.toggle('on', !!st.fullscreen);
  $('audioStandbyBtn').classList.toggle('on', st.audioStandby !== false);
}

function renderMore() {
  // downloads on the computer
  const dls = st.downloads || [];
  const dk = JSON.stringify([dls, lang]);
  if ($('dlList').dataset.key !== dk) {
    $('dlList').dataset.key = dk;
    $('dlList').innerHTML = dls.map(d => `<div class="dl ${d.status === 'error' ? 'error' : ''}">
      <span class="dt" dir="auto">${d.kind === 'mp3' ? '♪ ' : ''}${esc(d.title)}</span>
      <span class="dp">${d.status === 'error' ? esc(t('dlFailed')) : d.status === 'downloading' ? d.percent + '%' : esc(t('preparing'))}</span>
      ${d.status === 'error' ? '' : `<div class="dbar"><i style="width:${d.percent}%"></i></div>`}</div>`).join('');
  }
  // countdown
  const left = st.countdown ? Math.max(0, Math.ceil((st.countdown - Date.now()) / 1000)) : 0;
  $('cdBtn').classList.toggle('on', left > 0);
  $('cdLabel').textContent = left > 0 ? fmt(left) : t('countdown');
  $('cdStop').hidden = !(left > 0);
  // karaoke
  const k = st.karaoke || { kind: 'none' };
  $('karaokeBtn').hidden = k.kind === 'none';
  $('karaokeBtn').classList.toggle('on', k.kind === 'stems' && k.on);
  $('karaokeLabel').textContent = k.kind === 'job' ? t('separating', { n: k.progress || 0 }) : k.kind === 'stems' ? t('karaoke') : t('removeVocals');
  // playback options
  for (const b of document.querySelectorAll('#speedSeg button')) b.classList.toggle('on', Number(b.dataset.r) === (st.speed || 1));
  $('autoNextBtn').classList.toggle('on', !!st.autoNext);
  $('loopBtn').classList.toggle('on', !!st.loop);
  $('subsBtn').hidden = !st.subs;
  $('subsBtn').classList.toggle('on', !!st.subsOn);
  renderMixAndScreens();
  // lists
  const lk = JSON.stringify([st.lists, st.activeList, lang]);
  if ($('listChips').dataset.key !== lk) {
    $('listChips').dataset.key = lk;
    const lists = st.lists || [];
    $('listChips').hidden = !lists.length;
    $('listChips').innerHTML = [{ id: null, name: t('recents') }, ...lists].map(l =>
      `<button data-id="${esc(l.id ?? '')}" class="${(l.id ?? null) === (st.activeList ?? null) ? 'on' : ''}" dir="auto">${esc(l.name)}${l.count != null ? `<small>${l.count}</small>` : ''}</button>`).join('');
    for (const b of $('listChips').querySelectorAll('button')) b.onclick = () => send({ action: 'openList', id: b.dataset.id || null });
  }
}
setInterval(() => { if (st.countdown) renderMore(); }, 500);

// The pinned slide sits right under the (sticky) header.
function measureHeader() { document.documentElement.style.setProperty('--hh', document.querySelector('header').offsetHeight + 'px'); }
addEventListener('resize', measureHeader);
setTimeout(measureHeader, 0);

// ---------- tabs ----------
function selectTab(tab) {
  currentTab = tab === 'ppt' ? 'ppt' : 'play';
  try { localStorage.setItem('tab', currentTab); } catch {}
  for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x.dataset.tab === currentTab);
  renderShell();
  // Look for nearby computers only on the visible tab's pairing screen.
  for (const k of Object.keys(conns)) conns[k].stopNearby();
  const c = conns[currentTab];
  if (!$((currentTab === 'ppt' ? 'p-' : '') + 'pairScreen').hidden) c.searchNearby();
  if (currentTab === 'ppt' && pst.lang && pst.lang !== lang) setLang(pst.lang);
  if (currentTab === 'play' && st.lang && st.lang !== lang) setLang(st.lang);
  renderStatus();
  renderInstall();
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => selectTab(b.dataset.tab);

// ---------- install card ----------
// Shown until the app is installed (or closed): Android gets a real Install button, iPhone the
// two taps it takes from the Share menu.
let installPrompt = null;
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
function renderInstall() {
  let dismissed = false;
  try { dismissed = localStorage.getItem('installClosed') === '1'; } catch {}
  // Not over the remote itself: only on the pairing and connecting screens.
  const remoteShown = !$(shownTab() === 'ppt' ? 'p-remoteUi' : 'remoteUi').hidden;
  const show = !LAN && !installed() && !dismissed && (isIos || !!installPrompt) && !remoteShown;
  $('installCard').hidden = !show;
  if (!show) return;
  $('installBtn').hidden = isIos;
  $('installHow').innerHTML = isIos
    ? esc(t('installIos', { share: '@@' })).replace('@@', '<svg><use href="#i-share"/></svg>')
    : esc(t('installAndroid'));
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; renderInstall(); });
addEventListener('appinstalled', () => { installPrompt = null; renderInstall(); });
$('installBtn').onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  renderInstall();
};
$('installClose').onclick = () => { try { localStorage.setItem('installClosed', '1'); } catch {} renderInstall(); };

// ---------- start ----------
setLang(lang);
{
  const target = takePairLink();
  let tab = null;
  try { tab = localStorage.getItem('tab'); } catch {}
  currentTab = tab === 'ppt' ? 'ppt' : 'play';
  for (const x of document.querySelectorAll('.tabs button')) x.classList.toggle('on', x.dataset.tab === currentTab);
  $('tab-play').hidden = currentTab !== 'play';
  $('tab-slides').hidden = currentTab !== 'ppt';
  if (target && target !== 'old' && !LAN) dial(target); else startLink();
}
renderPpt();

// Works offline and installs as an app.
if ('serviceWorker' in navigator && !LAN) navigator.serviceWorker.register('/sw.js').catch(() => {});
