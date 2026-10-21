// Saved lists, search, the list check, video settings (start/end, volume, subtitles, lyrics),
// lyrics on screen, standby screen, countdown, settings, phone remote, shortcuts, the welcome
// tour, links from outside (clipboard, ma3madan://) and mini mode.
// Uses control.js globals: items, out, settings, $, t, toast, cmd, api, save, renderList, playItem,
// showMenu, closeMenu, openModal, closeModal, escapeHtml, uid, fmt, isAudio, lyricSlides, playingId,
// setTrim, startDownload, addStream, setLang, setTheme, LANG.

// ---------- saved lists ----------
// A list is a name and the ids of its videos; the videos themselves live in Recents, so a video's
// settings, thumbnail and download are shared by every list it's in.
let lists = []; // [{ id, name, itemIds }]
let searchQuery = '';
const saveLists = () => { api.saveLists(lists); };
async function loadLists() {
  lists = (await api.loadLists()).filter(l => l && l.id && Array.isArray(l.itemIds));
  const ids = new Set(items.map(x => x.id));
  for (const l of lists) l.itemIds = l.itemIds.filter(id => ids.has(id));
  if (settings.activeList && !lists.some(l => l.id === settings.activeList)) settings.activeList = null;
}
const activeList = () => lists.find(l => l.id === settings.activeList) || null;
function viewItems() {
  const l = activeList();
  return l ? l.itemIds.map(id => items.find(x => x.id === id)).filter(Boolean) : items;
}
// New videos go into the open list too (and always into Recents).
function addToActiveList(ids, afterId) {
  const l = activeList();
  if (!l) return;
  let at = afterId ? l.itemIds.indexOf(afterId) : -1;
  for (const id of ids) {
    if (l.itemIds.includes(id)) continue;
    if (at >= 0) l.itemIds.splice(++at, 0, id); else l.itemIds.push(id);
  }
  saveLists();
}
function forgetInLists(id) {
  let changed = false;
  for (const l of lists) if (l.itemIds.includes(id)) { l.itemIds = l.itemIds.filter(x => x !== id); changed = true; }
  if (changed) saveLists();
}
function moveItem(fromId, toId) {
  const l = activeList();
  if (l) {
    const ids = l.itemIds.filter(x => x !== fromId);
    ids.splice(ids.indexOf(toId), 0, fromId);
    l.itemIds = ids; saveLists();
  } else {
    const moving = items.find(x => x.id === fromId);
    items = items.filter(x => x.id !== fromId);
    items.splice(items.findIndex(x => x.id === toId), 0, moving);
    save();
  }
}
function openList(id) {
  settings.activeList = id; api.setSetting('activeList', id);
  closeSearch();
  renderList();
}

function renderListHead() {
  const l = activeList();
  $('listName').textContent = l ? l.name : t('playlist');
  $('listPick').classList.toggle('is-list', !!l);
  // The warning badge is for a meeting's list; Recents is just history.
  const n = l ? checkIssues(viewItems()).count : 0;
  $('checkBadge').hidden = !n;
  $('checkBadge').textContent = n;
  $('checkBtn').classList.toggle('warn', !!n);
}

$('listPick').onclick = () => {
  const r = $('listPick').getBoundingClientRect();
  const cur = activeList();
  const entries = [
    { label: t('playlist'), icon: 'i-resume', checked: !cur, action: () => openList(null) },
    ...(lists.length ? [{ heading: t('myLists') }] : []),
    ...lists.map(l => ({ label: `${l.name}  (${l.itemIds.length})`, icon: 'i-list', checked: cur?.id === l.id, action: () => openList(l.id) })),
    '-',
    { label: t('newList'), icon: 'i-add', action: () => askListName(null, name => { const l = { id: uid(), name, itemIds: [] }; lists.push(l); saveLists(); openList(l.id); }) },
  ];
  if (cur) {
    entries.push({ label: t('renameList'), icon: 'i-edit', action: () => askListName(cur, name => { cur.name = name; saveLists(); renderList(); }) },
      { label: t('deleteList'), icon: 'i-x', danger: true, action: () => confirmDeleteList(cur) });
  }
  showMenu(r.left, r.bottom + 4, entries);
};

function askListName(list, done) {
  openModal(`
    <h2>${escapeHtml(t(list ? 'renameList' : 'newList'))}</h2>
    <p class="muted">${escapeHtml(t('newListHint'))}</p>
    <input id="listNameInput" type="text" dir="auto" maxlength="60" value="${escapeHtml(list?.name || '')}" placeholder="${escapeHtml(t('listNamePh'))}">
    <div class="modal-actions">
      <button class="ghost" data-close>${escapeHtml(t('cancel'))}</button>
      <button id="listNameOk" class="primary" data-primary>${escapeHtml(t(list ? 'save' : 'create'))}</button>
    </div>`, { cls: 'narrow' });
  $('listNameInput').focus(); $('listNameInput').select();
  $('listNameOk').onclick = () => {
    const name = $('listNameInput').value.trim();
    if (!name) { $('listNameInput').focus(); return; }
    closeModal(); done(name);
  };
}
function confirmDeleteList(l) {
  openModal(`
    <h2>${escapeHtml(t('deleteListQ', { n: l.name }))}</h2>
    <p class="muted">${escapeHtml(t('deleteListHint'))}</p>
    <div class="modal-actions">
      <button class="ghost" data-close>${escapeHtml(t('cancel'))}</button>
      <button id="delListOk" class="danger-btn" data-primary>${escapeHtml(t('deleteList'))}</button>
    </div>`, { cls: 'narrow' });
  $('delListOk').onclick = () => { lists = lists.filter(x => x !== l); saveLists(); closeModal(); openList(null); };
  $('delListOk').focus();
}

// Entries for a video's ⋯ menu.
function listMenuEntries(it) {
  const cur = activeList();
  const entries = [{
    label: t('addToList'), icon: 'i-list', action: () => {
      const r = document.querySelector(`.item[data-id="${it.id}"]`)?.getBoundingClientRect() || { left: 200, bottom: 200 };
      showMenu(r.left + 40, r.bottom, [
        { heading: t('addToList') },
        ...lists.map(l => ({ label: l.name, icon: 'i-list', checked: l.itemIds.includes(it.id), action: () => {
          if (l.itemIds.includes(it.id)) l.itemIds = l.itemIds.filter(x => x !== it.id); else l.itemIds.push(it.id);
          saveLists(); renderList();
        } })),
        ...(lists.length ? ['-'] : []),
        { label: t('newList'), icon: 'i-add', action: () => askListName(null, name => { lists.push({ id: uid(), name, itemIds: [it.id] }); saveLists(); renderList(); }) },
      ]);
    },
  }];
  if (cur) entries.push({ label: t('removeFromThisList', { n: cur.name }), icon: 'i-x', action: () => { cur.itemIds = cur.itemIds.filter(x => x !== it.id); saveLists(); renderList(); } });
  return entries;
}

// ---------- search ----------
function openSearch() {
  if (settings.sidebarHidden) toggleSide();
  $('searchRow').hidden = false;
  $('searchBtn').classList.add('on');
  $('searchInput').focus(); $('searchInput').select();
}
function closeSearch() {
  $('searchRow').hidden = true;
  $('searchBtn').classList.remove('on');
  if (searchQuery) { searchQuery = ''; $('searchInput').value = ''; renderList(); }
}
$('searchBtn').onclick = () => ($('searchRow').hidden ? openSearch() : closeSearch());
$('searchClear').onclick = closeSearch;
$('searchInput').addEventListener('input', e => { searchQuery = e.target.value; renderList(); });
$('searchInput').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); }
  if (e.key === 'Enter') { const first = document.querySelector('#playlist .item'); if (first) playItem(items.find(x => x.id === first.dataset.id)); }
});

// ---------- check before the meeting ----------
function checkIssues(list) {
  const missing = list.filter(x => x.missing), online = list.filter(x => x.source === 'stream' && !x.missing);
  return { missing, online, ready: list.length - missing.length - online.length, count: missing.length + online.length };
}
function renderCheck() {
  const box = document.querySelector('.modal-box.check');
  if (!box) return;
  const list = viewItems(), c = checkIssues(list);
  const total = list.reduce((s, x) => s + (x.trim?.end ? x.trim.end - (x.trim.start || 0) : (x.duration || 0) - (x.trim?.start || 0)), 0);
  const busy = [...downloads.values()].filter(d => d.then === 'all' && d.status !== 'error').length;
  box.querySelector('.ck-body').innerHTML = `
    <div class="ck-row ok"><svg><use href="#i-check"/></svg><div><b>${escapeHtml(t('ckReady', { n: c.ready }))}</b><small>${escapeHtml(t('ckTotal', { t: fmt(total) }))}</small></div></div>
    ${c.online.length ? `<div class="ck-row warn"><svg><use href="#i-cloud"/></svg><div><b>${escapeHtml(t('ckOnline', { n: c.online.length }))}</b><small>${escapeHtml(t('ckOnlineHint'))}</small></div>
      <button id="ckDownload" class="primary" ${busy ? 'disabled' : ''}>${escapeHtml(busy ? t('ckDownloading', { n: busy }) : t('ckDownloadAll'))}</button></div>` : ''}
    ${c.missing.length ? `<div class="ck-row bad"><svg><use href="#i-warn"/></svg><div><b>${escapeHtml(t('ckMissing', { n: c.missing.length }))}</b><small dir="auto">${c.missing.slice(0, 4).map(x => escapeHtml(x.title)).join('، ')}${c.missing.length > 4 ? '…' : ''}</small></div>
      <button id="ckRemove">${escapeHtml(t('ckRemoveMissing'))}</button></div>` : ''}
    ${!c.count ? `<p class="ck-good">${escapeHtml(t('ckAllGood'))}</p>` : ''}`;
  $('ckDownload')?.addEventListener('click', () => {
    for (const it of c.online) startDownload(it.url, 'video', { replaceId: it.id, title: it.title, then: 'all' });
    renderCheck();
  });
  $('ckRemove')?.addEventListener('click', () => {
    const l = activeList();
    for (const it of c.missing) { if (l) l.itemIds = l.itemIds.filter(x => x !== it.id); else items = items.filter(x => x !== it); }
    if (l) saveLists(); else save();
    renderList(); renderCheck();
  });
}
function showCheck() {
  const l = activeList();
  openModal(`
    <h2><svg class="h-ico"><use href="#i-check"/></svg>${escapeHtml(t('ckTitle', { n: l ? l.name : t('playlist') }))}</h2>
    <p class="muted">${escapeHtml(t('ckIntro'))}</p>
    <div class="ck-body"></div>
    <div class="modal-actions"><button class="ghost" data-close>${escapeHtml(t('close'))}</button></div>`, { cls: 'check' });
  renderCheck();
}
$('checkBtn').onclick = showCheck;

// ---------- video settings: title, start/end, volume, subtitles, lyrics ----------
function parseTime(s) {
  s = String(s || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
  if (!s) return 0;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return null;
  return s.split(':').reduce((a, x) => a * 60 + parseFloat(x), 0);
}
function showItemSettings(it) {
  const playing = it.id === playingId && out.loaded;
  const vol = Math.round((it.volume || 1) * 100);
  let subs = it.subs; // path, false (off) or undefined (automatic)
  const box = openModal(`
    <h2>${escapeHtml(t('itemSettings'))}</h2>
    <label class="f-row"><span>${escapeHtml(t('fTitle'))}</span><input id="isTitle" type="text" dir="auto" value="${escapeHtml(it.title)}"></label>
    <div class="f-row"><span>${escapeHtml(t('fPart'))}</span>
      <div class="f-times">
        <label><small>${escapeHtml(t('fStart'))}</small><input id="isStart" type="text" dir="ltr" placeholder="0:00" value="${it.trim?.start ? fmt(it.trim.start) : ''}">${playing ? `<button class="small-btn" id="isStartNow">${escapeHtml(t('fNow'))}</button>` : ''}</label>
        <label><small>${escapeHtml(t('fEnd'))}</small><input id="isEnd" type="text" dir="ltr" placeholder="${escapeHtml(it.duration ? fmt(it.duration) : t('fToEnd'))}" value="${it.trim?.end ? fmt(it.trim.end) : ''}">${playing ? `<button class="small-btn" id="isEndNow">${escapeHtml(t('fNow'))}</button>` : ''}</label>
      </div></div>
    <div class="f-hint">${escapeHtml(t('fPartHint'))}</div>
    <label class="f-row"><span>${escapeHtml(t('fVolume'))}</span><span class="f-vol"><input id="isVol" class="range" type="range" min="25" max="200" step="5" value="${vol}" dir="ltr"><b id="isVolPct" dir="ltr">${vol}%</b></span></label>
    ${isAudio(it) || it.source === 'stream' ? '' : `<div class="f-row"><span>${escapeHtml(t('subtitles'))}</span><span class="f-subs"><span id="isSubsName" class="muted" dir="auto"></span><button class="small-btn" id="isSubsPick">${escapeHtml(t('fChoose'))}</button><button class="small-btn" id="isSubsOff">${escapeHtml(t('fNoSubs'))}</button></span></div>`}
    <label class="f-col"><span>${escapeHtml(t('lyrics'))} <small class="muted">${escapeHtml(t('fLyricsHint'))}</small></span><textarea id="isLyrics" dir="auto" rows="6" placeholder="${escapeHtml(t('fLyricsPh'))}">${escapeHtml(it.lyrics || '')}</textarea></label>
    <div class="modal-actions">
      <button class="ghost" data-close>${escapeHtml(t('cancel'))}</button>
      <button id="isSave" class="primary" data-primary>${escapeHtml(t('save'))}</button>
    </div>`, { cls: 'wide' });
  const vi = $('isVol');
  setFill(vi);
  vi.oninput = () => { $('isVolPct').textContent = vi.value + '%'; setFill(vi); if (playing) cmd('itemVolume', { v: vi.value / 100 }); };
  if (playing) {
    $('isStartNow').onclick = e => { e.preventDefault(); $('isStart').value = fmt(out.time); };
    $('isEndNow').onclick = e => { e.preventDefault(); $('isEnd').value = fmt(out.time); };
  }
  const renderSubs = async () => {
    if (!$('isSubsName')) return;
    const auto = subs === undefined ? await api.findSubs(it.path) : null;
    $('isSubsName').textContent = subs === false ? t('fSubsOff') : subs ? subs.split(/[\\/]/).pop() : auto ? t('fSubsAuto', { f: auto.split(/[\\/]/).pop() }) : t('fSubsNone');
  };
  renderSubs();
  $('isSubsPick')?.addEventListener('click', async () => { const p = await api.pickSubs(t('subtitles')); if (p) { subs = p; renderSubs(); } });
  $('isSubsOff')?.addEventListener('click', () => { subs = false; renderSubs(); });
  const restoreVolume = () => { if (playing) cmd('itemVolume', { v: it.volume || 1 }); };
  box.parentElement._onClose = restoreVolume;
  $('isSave').onclick = () => {
    const start = parseTime($('isStart').value), end = parseTime($('isEnd').value);
    if (start == null || end == null || (end && end <= start)) { toast(t('fBadTime')); return; }
    const subsChanged = subs !== it.subs;
    it.title = $('isTitle').value.trim() || it.title;
    it.volume = vi.value / 100 === 1 ? undefined : vi.value / 100;
    it.lyrics = $('isLyrics').value.trim() || undefined;
    if (subs === undefined) delete it.subs; else it.subs = subs;
    box.parentElement._onClose = null;
    closeModal();
    setTrim(it, { start, end });
    if (playing) {
      cmd('itemVolume', { v: it.volume || 1 });
      if (subsChanged) playItem(it, { autoplay: !out.paused, startAt: out.time });
    }
    save(); renderList(); renderState();
  };
  $('isTitle').focus();
}

// ---------- lyrics on screen ----------
// The lyrics of a song are written in its settings, one slide per paragraph. While it plays, the
// slides line up under the controls: click one (or Shift+N / Shift+P) to put it on screen.
let currentLyric = -1;
function renderLyricsBar() {
  const it = items.find(x => x.id === playingId);
  const slides = out.loaded ? lyricSlides(it) : [];
  $('lyricsBar').hidden = !slides.length;
  if (!slides.length) return;
  const cur = out.lyrics ? currentLyric : -1;
  const key = JSON.stringify([slides, cur]);
  const box = $('lyricSlides');
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = slides.map((s, i) => `<button class="lyr ${i === cur ? 'on' : ''}" data-i="${i}" dir="auto"><i>${i + 1}</i>${escapeHtml(s)}</button>`).join('');
  for (const b of box.querySelectorAll('.lyr')) b.onclick = () => (Number(b.dataset.i) === currentLyric && out.lyrics ? hideLyrics() : showLyric(Number(b.dataset.i)));
  box.querySelector('.lyr.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('lyricsOffBtn').disabled = cur < 0;
}
function showLyric(i) {
  const slides = lyricSlides(items.find(x => x.id === playingId));
  if (!slides[i]) return;
  currentLyric = i;
  cmd('lyrics', { text: slides[i] });
}
function stepLyric(d) {
  const slides = lyricSlides(items.find(x => x.id === playingId));
  if (!slides.length || !out.loaded) return;
  showLyric(Math.max(0, Math.min(slides.length - 1, currentLyric < 0 || !out.lyrics ? 0 : currentLyric + d)));
}
function hideLyrics() { currentLyric = -1; cmd('lyrics', { text: null }); }
$('lyricsOffBtn').onclick = hideLyrics;

// ---------- standby screen ----------
async function applyStandby() {
  const s = settings.standby || { kind: 'black' };
  const image = s.kind === 'image' && s.image && await api.fileExists(s.image) ? await api.fileUrl(s.image) : null;
  cmd('standby', { kind: s.kind, image, text: s.text || '' });
}

// ---------- countdown ----------
function showCountdown() {
  const running = !!out.countdown;
  const msg = settings.countdownText ?? t('cdDefaultMsg');
  openModal(`
    <h2><svg class="h-ico"><use href="#i-timer"/></svg>${escapeHtml(t('cdTitle'))}</h2>
    <p class="muted">${escapeHtml(t('cdIntro'))}</p>
    <div class="seg big" id="cdQuick">${[1, 2, 3, 5, 10, 15].map(m => `<button data-m="${m}">${escapeHtml(t('cdMin', { n: m }))}</button>`).join('')}</div>
    <div class="f-times cd-custom">
      <label><small>${escapeHtml(t('cdMinutes'))}</small><input id="cdMinutes" type="number" min="1" max="600" dir="ltr" placeholder="5"></label>
      <label><small>${escapeHtml(t('cdUntil'))}</small><input id="cdUntil" type="time" dir="ltr"></label>
    </div>
    <label class="f-col"><span>${escapeHtml(t('cdMessage'))}</span><input id="cdMsg" type="text" dir="auto" value="${escapeHtml(msg)}"></label>
    <div class="modal-actions">
      ${running ? `<button id="cdStop" class="danger-btn">${escapeHtml(t('cdStop'))}</button><span class="spacer"></span>` : ''}
      <button class="ghost" data-close>${escapeHtml(t('cancel'))}</button>
      <button id="cdStart" class="primary" data-primary>${escapeHtml(t('cdStart'))}</button>
    </div>`, { cls: 'narrow' });
  const start = until => {
    const text = $('cdMsg').value.trim();
    settings.countdownText = text; api.setSetting('countdownText', text);
    cmd('countdown', { until, text });
    closeModal();
  };
  for (const b of document.querySelectorAll('#cdQuick button')) b.onclick = () => start(Date.now() + Number(b.dataset.m) * 60000 + 900);
  $('cdStart').onclick = () => {
    const m = Number($('cdMinutes').value), until = $('cdUntil').value;
    if (until) {
      const [h, mi] = until.split(':').map(Number);
      const d = new Date(); d.setHours(h, mi, 0, 0);
      if (d < Date.now()) d.setDate(d.getDate() + 1);
      start(d.getTime());
    } else if (m > 0) start(Date.now() + m * 60000 + 900);
    else $('cdMinutes').focus();
  };
  $('cdStop')?.addEventListener('click', () => { cmd('countdown', { until: 0 }); closeModal(); });
}
$('countdownBtn').onclick = showCountdown;

// ---------- settings ----------
function showSettings() {
  const s = settings;
  const seg = (k, opts, cur) => `<div class="seg" data-k="${k}">${opts.map(([v, label]) => `<button data-v="${escapeHtml(v)}" class="${String(v) === String(cur) ? 'on' : ''}">${escapeHtml(label)}</button>`).join('')}</div>`;
  const sw = (k, on, label, hint) => `<label class="sw-row"><span><b>${escapeHtml(label)}</b>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</span><input type="checkbox" class="switch" data-k="${k}" ${on ? 'checked' : ''}></label>`;
  const sb = s.standby || { kind: 'black' };
  openModal(`
    <h2><svg class="h-ico"><use href="#i-gear"/></svg>${escapeHtml(t('settings'))}</h2>
    <div class="set-body">
      <section><h3>${escapeHtml(t('sAppearance'))}</h3>
        <div class="set-row"><span>${escapeHtml(t('sTheme'))}</span>${seg('theme', [['system', t('themeSystemShort')], ['light', t('themeLightShort')], ['dark', t('themeDarkShort')]], s.theme || 'system')}</div>
        <div class="set-row"><span>${escapeHtml(t('sLanguage'))}</span>${seg('lang', [['en', 'English'], ['ar', 'العربية']], LANG)}</div>
      </section>
      <section><h3>${escapeHtml(t('sPresenting'))}</h3>
        <div class="set-row"><span>${escapeHtml(t('sFade'))}<small>${escapeHtml(t('sFadeHint'))}</small></span>${seg('fade', [[0, t('off')], [0.5, '0.5 s'], [1, '1 s'], [2, '2 s']], s.fadeSec ?? 1)}</div>
        <div class="set-row"><span>${escapeHtml(t('sStandby'))}<small>${escapeHtml(t('sStandbyHint'))}</small></span>${seg('standby', [['black', t('sbBlack')], ['image', t('sbImage')], ['text', t('sbText')]], sb.kind)}</div>
        <div id="sbImageRow" class="set-sub" ${sb.kind === 'image' ? '' : 'hidden'}>
          <span id="sbImageName" class="muted" dir="auto">${escapeHtml(sb.image ? sb.image.split(/[\\/]/).pop() : t('sbNoImage'))}</span>
          <button id="sbImagePick" class="small-btn"><svg><use href="#i-image"/></svg>${escapeHtml(t('fChoose'))}</button>
        </div>
        <div id="sbTextRow" class="set-sub" ${sb.kind === 'text' ? '' : 'hidden'}>
          <textarea id="sbText" dir="auto" rows="2" placeholder="${escapeHtml(t('sbTextPh'))}">${escapeHtml(sb.text || '')}</textarea>
        </div>
        ${sw('resume', s.resume !== false, t('sResume'), t('sResumeHint'))}
      </section>
      <section><h3>YouTube</h3>
        ${sw('clipboardLinks', s.clipboardLinks !== false, t('sClipboard'), t('sClipboardHint'))}
        <div class="set-row"><span>yt-dlp<small>${escapeHtml(t('sYtdlpHint'))}</small></span><button id="ytUpdateBtn" class="small-btn">${escapeHtml(t('updateYtdlp'))}</button></div>
      </section>
      <section><h3>${escapeHtml(t('sMore'))}</h3>
        <div class="set-btns">
          <button id="setVocals"><svg><use href="#i-mic"/></svg>${escapeHtml(t('vdTitle'))}</button>
          <button id="setRemote"><svg><use href="#i-phone"/></svg>${escapeHtml(t('remoteTitle'))}</button>
          <button id="setKeys"><svg><use href="#i-keyboard"/></svg>${escapeHtml(t('shortcuts'))}</button>
          <button id="setTour"><svg><use href="#i-info"/></svg>${escapeHtml(t('tourAgain'))}</button>
        </div>
      </section>
    </div>
    <div class="modal-actions"><button class="primary" data-close>${escapeHtml(t('done'))}</button></div>`, { cls: 'wide settings' });
  const box = document.querySelector('.modal-box.settings');
  for (const g of box.querySelectorAll('.seg')) for (const b of g.querySelectorAll('button')) b.onclick = () => {
    for (const x of g.querySelectorAll('button')) x.classList.toggle('on', x === b);
    const v = b.dataset.v;
    if (g.dataset.k === 'theme') setTheme(v);
    else if (g.dataset.k === 'lang') { setLang(v); showSettings(); }
    else if (g.dataset.k === 'fade') { settings.fadeSec = Number(v); api.setSetting('fadeSec', Number(v)); cmd('fade', { sec: Number(v) }); }
    else if (g.dataset.k === 'standby') {
      settings.standby = { ...(settings.standby || {}), kind: v }; api.setSetting('standby', settings.standby); applyStandby();
      $('sbImageRow').hidden = v !== 'image'; $('sbTextRow').hidden = v !== 'text';
      if (v === 'image' && !settings.standby.image) $('sbImagePick').click();
    }
  };
  for (const c of box.querySelectorAll('.switch')) c.onchange = () => { settings[c.dataset.k] = c.checked; api.setSetting(c.dataset.k, c.checked); };
  $('sbImagePick').onclick = async () => {
    const p = await api.pickImage(t('sbImage'));
    if (!p) return;
    settings.standby = { ...(settings.standby || {}), kind: 'image', image: p }; api.setSetting('standby', settings.standby);
    $('sbImageName').textContent = p.split(/[\\/]/).pop();
    applyStandby();
  };
  $('sbText').oninput = e => { settings.standby = { ...(settings.standby || {}), kind: 'text', text: e.target.value }; api.setSetting('standby', settings.standby); applyStandby(); };
  $('ytUpdateBtn').onclick = async () => {
    const b = $('ytUpdateBtn');
    b.disabled = true; b.textContent = t('updating');
    const msg = await api.updateYtdlp();
    if (!b.isConnected) return;
    b.disabled = false; b.textContent = t('updateYtdlp');
    b.title = msg;
    b.insertAdjacentHTML('beforebegin', `<small class="muted yt-msg" dir="ltr">${escapeHtml(msg)}</small>`);
  };
  $('setVocals').onclick = () => showVocalSettings();
  $('setRemote').onclick = showRemote;
  $('setKeys').onclick = showShortcuts;
  $('setTour').onclick = showOnboarding;
}
$('settingsBtn').onclick = showSettings;

// ---------- phone remote ----------
// Two ways in, both on while the remote is on:
// - the phone app (Ma3madan Remote): pair once with the QR code, then it finds this PC by itself
//   and talks to it directly over the Wi-Fi (link-host.js; the internet is needed only for the
//   moment of connecting);
// - the Wi-Fi page (remote.js): needs no internet at all, but its address changes with the network.
let remote = { on: false };
let hostName = '';
let lanOpen = false;
function renderRemoteBtn() {
  $('remoteBtn').classList.toggle('on', !!remote.on);
  $('remoteBtn').classList.toggle('linked', !!(remote.clients || LinkHost.connected()));
}
async function startLink() {
  if (!settings.linkKey) { settings.linkKey = MaLink.randomId(18); api.setSetting('linkKey', settings.linkKey); }
  hostName ||= await api.hostName();
  await LinkHost.start(settings.linkKey, {
    name: hostName, onCommand: remoteCommand, thumb: thumbData,
    onChange: () => { renderRemoteBtn(); renderRemoteModal(); },
  });
  pushRemote();
}
// Called once the settings are loaded: the remote comes back on if it was on.
async function initRemote() {
  remote = await api.remoteInfo();
  renderRemoteBtn();
  if (remote.on && !settings._selftest) startLink().catch(e => console.warn('link', e));
}
// A small JPEG of a video's thumbnail, sent to the phone app over the connection.
async function thumbData(id) {
  const it = items.find(x => x.id === id);
  if (!it?.thumbUrl) return null;
  const img = new Image();
  img.src = it.thumbUrl;
  try { await img.decode(); } catch { return null; }
  const c = document.createElement('canvas');
  c.width = 160; c.height = Math.round((160 * img.naturalHeight) / img.naturalWidth) || 90;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}
async function showRemote() {
  remote = await api.remoteInfo();
  renderRemoteBtn();
  openModal(`<div id="remoteBody"></div>`, { cls: 'remote wide' });
  renderRemoteModal();
}
async function renderRemoteModal() {
  if (!$('remoteBody')) return;
  let html;
  if (!remote.on) {
    html = `
      <h2><svg class="h-ico"><use href="#i-phone"/></svg>${escapeHtml(t('remoteTitle'))}</h2>
      <p>${escapeHtml(t('remoteIntro'))}</p>
      <ul class="r-points"><li>${escapeHtml(t('remoteP1'))}</li><li>${escapeHtml(t('remoteP2'))}</li><li>${escapeHtml(t('remoteP3'))}</li></ul>
      <div class="modal-actions"><button class="ghost" data-close>${escapeHtml(t('close'))}</button><button id="rOn" class="primary" data-primary>${escapeHtml(t('remoteOn'))}</button></div>`;
  } else {
    const qr = LinkHost.isRunning() ? await api.qrSvg(LinkHost.pairUrl(hostName)) : '';
    const n = LinkHost.connected() + (remote.clients || 0);
    html = `
      <h2><svg class="h-ico"><use href="#i-phone"/></svg>${escapeHtml(t('remoteTitle'))}<span class="r-live">${escapeHtml(t('remoteIsOn'))}</span></h2>
      <div class="r-grid">
        <div class="qr">${qr}</div>
        <div class="r-info">
          <b>${escapeHtml(t('appScan'))}</b>
          <ol class="r-steps"><li>${escapeHtml(t('appStep1'))}</li><li>${escapeHtml(t('appStep2'))}</li><li>${escapeHtml(t('appStep3'))}</li></ol>
          <p class="r-count">${escapeHtml(n ? t('remoteClients', { n }) : t('remoteNoClients'))}</p>
          ${LinkHost.isOnline() === false ? `<p class="warn-text small">${escapeHtml(t('appOffline'))}</p>` : ''}
        </div>
      </div>
      <details class="r-lan" ${lanOpen ? 'open' : ''}>
        <summary>${escapeHtml(t('lanTitle'))}</summary>
        <div class="r-grid">
          <div class="qr">${remote.qr || ''}</div>
          <div class="r-info">
            <p class="muted">${escapeHtml(t('lanText'))}</p>
            ${remote.urls?.length ? `<code dir="ltr">${escapeHtml(remote.urls[0])}</code>` : `<p class="warn-text">${escapeHtml(t('remoteNoNet'))}</p>`}
            <p class="muted small">${escapeHtml(t('remoteFirewall'))}</p>
          </div>
        </div>
      </details>
      <div class="modal-actions">
        <button id="rOff" class="danger-btn">${escapeHtml(t('remoteOff'))}</button>
        <button id="rNewKey" class="ghost" title="${escapeHtml(t('remoteNewKeyTip'))}">${escapeHtml(t('remoteNewKey'))}</button>
        <span class="spacer"></span>
        <button class="primary" data-close>${escapeHtml(t('done'))}</button>
      </div>`;
  }
  const body = $('remoteBody');
  if (!body || body.dataset.html === html) return;
  body.dataset.html = html;
  body.innerHTML = html;
  for (const b of body.querySelectorAll('[data-close]')) b.onclick = closeModal;
  body.querySelector('details')?.addEventListener('toggle', e => { lanOpen = e.target.open; });
  $('rOn')?.addEventListener('click', async () => {
    const r = await api.remoteStart();
    if (!r.ok) { toast(t('remoteFailed', { e: r.error })); return; }
    remote = r; renderRemoteBtn();
    await startLink();
    renderRemoteModal();
  });
  $('rOff')?.addEventListener('click', async () => { remote = await api.remoteStop(); LinkHost.stop(); renderRemoteBtn(); renderRemoteModal(); });
  // A new code: every paired phone (app and Wi-Fi page) has to scan again.
  $('rNewKey')?.addEventListener('click', async () => {
    const r = await api.remoteNewKey();
    if (!r.ok) return;
    remote = r;
    settings.linkKey = MaLink.randomId(18); api.setSetting('linkKey', settings.linkKey);
    await startLink();
    renderRemoteModal();
  });
}
$('remoteBtn').onclick = showRemote;

// The phone's buttons do exactly what the same buttons here do.
async function remoteCommand(c) {
  switch (c.action) {
    case 'toggle': togglePlay(); break;
    case 'next': nextItem(); break;
    case 'prev': prevItem(); break;
    case 'back': cmd('seekBy', { d: -10 }); break;
    case 'fwd': cmd('seekBy', { d: 10 }); break;
    case 'stop': cmd('stop'); break;
    case 'black': cmd('black', { on: !out.black }); break;
    case 'freeze': cmd('freeze', { on: !out.frozen }); break;
    case 'mute': toggleMute(); break;
    case 'volume': if (typeof c.v === 'number') setVolume(c.v); break;
    case 'play': { const it = items.find(x => x.id === c.id); if (it) playItem(it); break; }
    case 'lyric': if (Number.isInteger(c.i)) (c.i === currentLyric && out.lyrics ? hideLyrics() : showLyric(c.i)); break;
    case 'lyricsOff': hideLyrics(); break;
    case 'seek': if (typeof c.t === 'number' && isFinite(c.t)) cmd('seek', { t: c.t }); break;
    case 'mark': if (Number.isInteger(c.i)) goToMark(c.i); break;
    case 'addMark': addMark({ rename: false }); break;
    case 'clients': remote = await api.remoteInfo(); renderRemoteBtn(); renderRemoteModal(); break;
  }
  pushRemote();
}
api.onRemoteCmd(remoteCommand);

// ---------- keyboard shortcuts ----------
function showShortcuts() {
  const groups = [
    [t('gPlayback'), [['Space', t('kPlay')], ['N / P', t('kNextPrev')], ['← →', t('kSeek5')], ['J / L', t('kSeek10')], ['Shift + ← →', t('kSeek30')], ['0 – 9', t('kJump')], ['[ ]', t('kFrame')], ['Home / End', t('kHomeEnd')], ['I / O', t('kTrim')], ['Ctrl + D / Alt + ← →', t('kMarks')]]],
    [t('gScreen'), [['B', t('kStandby')], ['Z', t('kFreeze')], ['T', t('kCountdown')], ['F', t('kFull')], ['A', t('kAspect')], ['C', t('kSubs')], ['Shift + N / P', t('kLyrics')], ['Esc', t('kEsc')]]],
    [t('gSound'), [['↑ ↓', t('kVolume')], ['M', t('kMute')]]],
    [t('kWindow'), [['Ctrl + O', t('addVideos')], ['Ctrl + F', t('tSearch')], ['Ctrl + B', t('kSide')], ['Ctrl + M', t('tMini')], ['Ctrl + ,', t('settings')], ['Shift + ↑ ↓', t('kSelect')], ['Enter', t('kPlaySel')], ['?', t('shortcuts')]]],
  ];
  openModal(`
    <h2><svg class="h-ico"><use href="#i-keyboard"/></svg>${escapeHtml(t('shortcuts'))}</h2>
    <div class="keys">${groups.map(([g, rows]) => `<section><h3>${escapeHtml(g)}</h3>${rows.map(([k, d]) => `<div class="key-line"><span>${escapeHtml(d)}</span><span class="kk">${k.split(' / ').map(x => `<kbd>${escapeHtml(x)}</kbd>`).join(' ')}</span></div>`).join('')}</section>`).join('')}</div>
    <div class="modal-actions"><button class="primary" data-close>${escapeHtml(t('done'))}</button></div>`, { cls: 'wide keys-modal' });
}

// ---------- welcome tour (first run) ----------
function showOnboarding() {
  const steps = [
    { icon: 'i-screens', title: t('ob1Title'), text: t('ob1Text') },
    { icon: 'i-list', title: t('ob2Title'), text: t('ob2Text') },
    { icon: 'i-phone', title: t('ob3Title'), text: t('ob3Text') },
  ];
  let i = 0;
  const finish = () => { settings.onboarded = true; api.setSetting('onboarded', true); };
  openModal('<div id="obBody"></div>', { cls: 'tour', onClose: finish });
  const render = () => {
    const s = steps[i];
    $('obBody').innerHTML = `
      <div class="ob-art"><img src="assets/app-128.png" alt=""><span><svg><use href="#${s.icon}"/></svg></span></div>
      <div class="ob-step">${steps.map((_, j) => `<i class="${j === i ? 'on' : ''}"></i>`).join('')}</div>
      <h2>${escapeHtml(s.title)}</h2>
      <p>${escapeHtml(s.text)}</p>
      <div class="modal-actions">
        ${i === 0 ? `<button class="ghost" id="obSkip">${escapeHtml(t('obSkip'))}</button>` : `<button class="ghost" id="obBack">${escapeHtml(t('obBack'))}</button>`}
        <span class="spacer"></span>
        <button class="primary" id="obNext" data-primary>${escapeHtml(i === steps.length - 1 ? t('obStart') : t('obNext'))}</button>
      </div>`;
    $('obSkip')?.addEventListener('click', closeModal);
    $('obBack')?.addEventListener('click', () => { i--; render(); });
    $('obNext').onclick = () => { if (i === steps.length - 1) closeModal(); else { i++; render(); } };
    $('obNext').focus();
  };
  render();
}

// ---------- links from outside ----------
// A YouTube link copied elsewhere (WhatsApp, a browser): when you come back to the app, a small
// banner offers to play it. ma3madan:// links open straight away.
let clipUrl = null;
api.onClipboardLink(url => {
  if (items.some(x => x.url === url)) return;
  clipUrl = url;
  $('clipUrl').textContent = url.replace(/^https?:\/\/(www\.)?/, '');
  $('clipBanner').hidden = false;
  if (settings.sidebarHidden) toggleSide();
});
const hideClip = () => { $('clipBanner').hidden = true; clipUrl = null; };
$('clipPlay').onclick = () => { const u = clipUrl; hideClip(); if (u) addStream(u, { play: true }); };
$('clipDl').onclick = e => { const u = clipUrl; downloadMenu(e.currentTarget, () => { hideClip(); return u; }); };
$('clipClose').onclick = hideClip;
function openLink(url) { addStream(url, { play: true }); }
api.onOpenLink(openLink);

// ---------- mini mode ----------
function toggleMini() { api.setMini(!document.body.classList.contains('mini')); }
$('miniBtn').onclick = toggleMini;
api.onMini(on => {
  document.body.classList.toggle('mini', on);
  setIcon($('miniBtn'), on ? 'i-expand' : 'i-mini');
  $('miniBtn').dataset.tip = t(on ? 'tMiniOff' : 'tMini');
  closeMenu();
  requestAnimationFrame(sendPlayerRect);
});

// ---------- checkpoints ----------
// Named moments in a video ("Verse 1", "Chorus"…), added by hand while it plays. They show under
// the list and as ticks on the seek bar; a click (here or on the phone) jumps there.
let editingMark = -1; // the checkpoint being renamed
const marksOf = it => it?.marks || [];
function currentMark(marks) {
  let i = -1;
  marks.forEach((m, j) => { if (m.t <= out.time + 0.25) i = j; });
  return i;
}
function renderMarks() {
  const it = items.find(x => x.id === playingId);
  const show = !!(out.loaded && it);
  $('marksPanel').hidden = !show;
  if (!show) return;
  const marks = marksOf(it), cur = currentMark(marks);
  const key = JSON.stringify([it.id, marks, cur, editingMark, LANG]);
  const list = $('marksList');
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  $('marksFor').textContent = it.title;
  $('marksEmpty').hidden = !!marks.length;
  list.innerHTML = marks.map((m, i) => `
    <li class="mark ${i === cur ? 'on' : ''}" data-i="${i}">
      <span class="mt" dir="ltr">${fmt(m.t)}</span>
      ${i === editingMark
        ? `<input class="ml-edit" type="text" dir="auto" maxlength="60" value="${escapeHtml(m.label)}">`
        : `<span class="ml" dir="auto">${escapeHtml(m.label)}</span>`}
      <button class="ib-x" data-act="rename" title="${escapeHtml(t('markRename'))}"><svg><use href="#i-edit"/></svg></button>
      <button class="ib-x" data-act="delete" title="${escapeHtml(t('remove'))}"><svg><use href="#i-x"/></svg></button>
    </li>`).join('');
  for (const li of list.querySelectorAll('.mark')) {
    const i = Number(li.dataset.i);
    li.onclick = e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'delete') { it.marks.splice(i, 1); editingMark = -1; save(); renderMarks(); renderTrimMarks(); return; }
      if (act === 'rename') { editingMark = i; renderMarks(); return; }
      if (!e.target.closest('input')) goToMark(i);
    };
    li.ondblclick = e => { if (!e.target.closest('button')) { editingMark = i; renderMarks(); } };
  }
  const input = list.querySelector('.ml-edit');
  if (input) {
    const done = keep => {
      if (editingMark < 0) return;
      if (keep && input.value.trim()) it.marks[editingMark].label = input.value.trim();
      editingMark = -1; save(); renderMarks();
    };
    input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    input.onblur = () => done(true);
    input.focus(); input.select();
  }
  list.querySelector('.mark.on')?.scrollIntoView({ block: 'nearest' });
}
function goToMark(i) {
  const m = marksOf(items.find(x => x.id === playingId))[i];
  if (m) cmd('seek', { t: m.t });
}
// A new checkpoint at the current moment, named "Point 3" until it's renamed.
function addMark({ label, rename = true } = {}) {
  const it = items.find(x => x.id === playingId);
  if (!it || !out.loaded) return;
  const at = Math.round(out.time * 10) / 10;
  it.marks = marksOf(it).filter(m => Math.abs(m.t - at) > 0.5);
  it.marks.push({ t: at, label: label || t('markN', { n: it.marks.length + 1 }) });
  it.marks.sort((a, b) => a.t - b.t);
  editingMark = rename ? it.marks.findIndex(m => m.t === at) : -1;
  if (settings.sidebarHidden && rename) toggleSide();
  save(); renderMarks(); renderTrimMarks(); pushRemote();
}
// Previous / next checkpoint from where the video is now.
function stepMark(d) {
  const marks = marksOf(items.find(x => x.id === playingId));
  if (!marks.length) return;
  const now = out.time;
  const m = d > 0 ? marks.find(x => x.t > now + 0.5) : [...marks].reverse().find(x => x.t < now - 1.5);
  cmd('seek', { t: m ? m.t : d > 0 ? marks[marks.length - 1].t : marks[0].t });
}
$('markAddBtn').onclick = () => addMark();
