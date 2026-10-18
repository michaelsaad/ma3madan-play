// Vocal remover UI: the engine choice (online / this PC), separation jobs, playlist menu entries,
// and the live mixer for an item whose music and vocals have been separated.
// Uses control.js globals: items, out, settings, $, t, toast, cmd, api, save, renderList, playItem,
// showMenu, escapeHtml, uid, isAudio, LANG.

const vocalJobs = new Map(); // job id -> { itemId, title, stage, progress, position, error }
const MVSEP_KEY_PAGE = 'https://mvsep.com/user-api';

const jobFor = it => [...vocalJobs.values()].find(j => j.itemId === it.id && !['done', 'error', 'canceled'].includes(j.stage));

// ---------- engine choice ----------
function showVocalSettings(onDone) {
  const engine = settings.vocalEngine || 'online';
  const box = $('modal');
  box.innerHTML = `
    <div class="modal-box" role="dialog" aria-modal="true">
      <h2>${escapeHtml(t('vdTitle'))}</h2>
      <p class="muted">${escapeHtml(t('vdIntro'))}</p>
      <label class="choice"><input type="radio" name="veng" value="online" ${engine === 'online' ? 'checked' : ''}>
        <span><b>${escapeHtml(t('vdOnline'))}</b><small>${escapeHtml(t('vdOnlineDesc'))}</small></span></label>
      <div class="key-row">
        <input id="mvsepKey" type="password" dir="ltr" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t('vdKey'))}" value="${escapeHtml(settings.mvsepToken || '')}">
        <button id="mvsepGetKey" class="ghost small">${escapeHtml(t('vdGetKey'))}</button>
      </div>
      <label class="choice"><input type="radio" name="veng" value="local" ${engine === 'local' ? 'checked' : ''}>
        <span><b>${escapeHtml(t('vdLocal'))}</b><small>${escapeHtml(t('vdLocalDesc'))}</small></span></label>
      <div class="modal-actions">
        <button id="vdCancel" class="ghost">${escapeHtml(t('vdCancel'))}</button>
        <button id="vdOk" class="primary">${escapeHtml(t(onDone ? 'vdStart' : 'vdSave'))}</button>
      </div>
    </div>`;
  box.hidden = false;
  const close = () => { box.hidden = true; box.innerHTML = ''; };
  $('mvsepGetKey').onclick = () => api.openExternal(MVSEP_KEY_PAGE);
  $('vdCancel').onclick = close;
  box.onmousedown = e => { if (e.target === box) close(); };
  $('vdOk').onclick = () => {
    const choice = box.querySelector('input[name=veng]:checked').value;
    const key = $('mvsepKey').value.trim();
    if (choice === 'online' && !key) { toast(t('vdNeedKey')); $('mvsepKey').focus(); return; }
    settings.vocalEngine = choice; api.setSetting('vocalEngine', choice);
    settings.mvsepToken = key; api.setSetting('mvsepToken', key);
    close();
    onDone?.();
  };
  (engine === 'online' ? $('mvsepKey') : box.querySelector('input[value=local]')).focus();
}
$('modal').addEventListener('keydown', e => {
  e.stopPropagation(); // the player's shortcuts must not fire while typing a key
  if (e.key === 'Escape') { $('modal').hidden = true; $('modal').innerHTML = ''; }
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') $('vdOk')?.click();
});

// ---------- jobs ----------
function removeVocals(it) {
  if (jobFor(it)) return;
  const ready = settings.vocalEngine === 'local' || (settings.vocalEngine === 'online' && settings.mvsepToken);
  if (!ready) { showVocalSettings(() => removeVocals(it)); return; }
  const id = uid();
  vocalJobs.set(id, { itemId: it.id, title: it.title, stage: 'waiting' });
  // A YouTube download keeps its sound in a separate .m4a; separate that rather than the video.
  api.vocalsStart({ id, input: it.audioPath || it.path, title: it.title, engine: settings.vocalEngine });
  renderVocalJobs();
}

api.onVocalsEvent(ev => {
  const job = vocalJobs.get(ev.id);
  if (!job) return;
  Object.assign(job, ev);
  if (ev.stage === 'done') {
    const it = items.find(x => x.id === job.itemId);
    if (it) {
      it.stems = { music: ev.music, vocals: ev.vocals };
      it.stemsOn = true;
      it.mix = { music: 1, vocals: 0 }; // karaoke to start with
      save(); renderList();
      if (out.loaded && it.id === playingId) reloadKeepingPlace(it);
    }
    toast(t('vjDone', { t: job.title }));
    vocalJobs.delete(ev.id);
  } else if (ev.stage === 'canceled') {
    vocalJobs.delete(ev.id);
  } else if (ev.stage === 'error' && (ev.error === 'NO_TOKEN' || /invalid token/i.test(ev.error))) {
    // Missing or wrong MVSEP key: show the error briefly, then let them fix the key.
    if (ev.error === 'NO_TOKEN') vocalJobs.delete(ev.id);
    showVocalSettings();
  }
  renderVocalJobs();
});

function jobText(j) {
  switch (j.stage) {
    case 'waiting': return t('vjWaiting');
    case 'uploading': return t('vjUploading');
    case 'queued': return j.position ? t('vjQueued', { p: j.position }) : t('vjQueuedNoPos');
    case 'processing': return j.progress != null ? t('vjProcessing', { n: Math.round(j.progress * 100) }) : t('vjProcessingNoPct');
    case 'downloading': return t('vjDownloading');
    case 'error': return t('vjError', { e: j.error || '' });
    default: return t('vjWaiting');
  }
}

function renderVocalJobs() {
  const box = $('vocalJobs');
  if (!box) return;
  box.innerHTML = '';
  for (const [id, j] of vocalJobs) {
    const el = document.createElement('div');
    el.className = 'dl' + (j.stage === 'error' ? ' error' : '');
    const pct = j.stage === 'processing' && j.progress != null ? j.progress * 100 : j.stage === 'downloading' ? 100 * (j.progress || 0) : null;
    el.innerHTML = `
      <div class="dl-top"><svg class="mic-ico"><use href="#i-mic"/></svg>
        <span class="dl-title" dir="auto">${escapeHtml(j.title)}</span>
        <button title="${escapeHtml(j.stage === 'error' ? t('remove') : t('cancel'))}"><svg><use href="#i-x"/></svg></button></div>
      ${j.stage === 'error' ? '' : `<div class="bar${pct == null ? ' busy' : ''}"><i style="width:${pct ?? 30}%"></i></div>`}
      <div class="dl-meta" dir="auto">${escapeHtml(jobText(j))}</div>`;
    el.querySelector('button').onclick = () => {
      if (j.stage === 'error') { vocalJobs.delete(id); renderVocalJobs(); }
      else api.vocalsCancel(id);
    };
    box.appendChild(el);
  }
}

// ---------- playlist menu ----------
function vocalMenuEntries(it) {
  if (it.source === 'stream' || it.missing) return [];
  const entries = ['-'];
  const job = jobFor(it);
  if (job) {
    entries.push({ label: t('menuCancelVocals'), icon: 'i-mic', action: () => api.vocalsCancel([...vocalJobs].find(([, j]) => j === job)[0]) });
  } else if (it.stems) {
    entries.push({ label: t(it.stemsOn ? 'menuKaraokeOff' : 'menuKaraokeOn'), icon: 'i-mic', action: () => setStemsOn(it, !it.stemsOn) });
    entries.push({ label: t('menuSaveMix'), icon: 'i-music', action: () => saveMix(it) });
  } else {
    entries.push({ label: t('menuRemoveVocals'), icon: 'i-mic', action: () => removeVocals(it) });
  }
  entries.push({ label: t('menuVocalSettings'), icon: 'i-gear', action: () => showVocalSettings() });
  return entries;
}

function reloadKeepingPlace(it) {
  playItem(it, { autoplay: !out.paused, startAt: out.time });
}

function setStemsOn(it, on) {
  it.stemsOn = on;
  save(); renderList();
  if (out.loaded && it.id === playingId) reloadKeepingPlace(it);
}

async function saveMix(it, gains = it.mix || { music: 1, vocals: 0 }) {
  const name = gains.vocals === 0 ? `${it.title} (${t('presetKaraoke')})`
    : gains.music === 0 ? `${it.title} (${t('presetVocals')})`
    : `${it.title} (${t('mixLabel')})`;
  toast(t('savingMix'));
  const r = await api.saveMix({ music: it.stems.music, vocals: it.stems.vocals, gains, title: name, dialogTitle: t('menuSaveMix') });
  if (r.ok) toast(t('mixSaved', { f: r.path.split(/[\\/]/).pop() }));
  else if (!r.canceled) toast(t('vjError', { e: r.error }));
}

// ---------- mixer (shown while a separated item plays) ----------
const PRESETS = { karaoke: { music: 1, vocals: 0 }, original: { music: 1, vocals: 1 }, vocals: { music: 0, vocals: 1 } };
const playingItem = () => items.find(x => x.id === playingId);

function renderMixer() {
  const it = playingItem();
  const show = !!(out.loaded && out.stems && it?.stems && it.stemsOn);
  $('mixer').hidden = !show;
  if (!show) return;
  const m = it.mix || PRESETS.karaoke;
  for (const [k, input, label] of [['vocals', $('mixVocals'), $('mixVocalsPct')], ['music', $('mixMusic'), $('mixMusicPct')]]) {
    if (document.activeElement !== input) input.value = Math.round(m[k] * 100);
    setFill(input);
    label.textContent = Math.round(m[k] * 100) + '%';
  }
  for (const b of document.querySelectorAll('#mixer [data-preset]')) {
    const p = PRESETS[b.dataset.preset];
    b.classList.toggle('on', Math.abs(p.music - m.music) < 0.01 && Math.abs(p.vocals - m.vocals) < 0.01);
  }
}

function setMix(m) {
  const it = playingItem();
  if (!it) return;
  it.mix = { music: Math.max(0, Math.min(1, m.music)), vocals: Math.max(0, Math.min(1, m.vocals)) };
  cmd('mix', it.mix);
  save();
  renderMixer();
}
$('mixVocals').addEventListener('input', e => setMix({ ...(playingItem()?.mix || PRESETS.karaoke), vocals: e.target.value / 100 }));
$('mixMusic').addEventListener('input', e => setMix({ ...(playingItem()?.mix || PRESETS.karaoke), music: e.target.value / 100 }));
for (const input of [$('mixVocals'), $('mixMusic')]) input.addEventListener('change', e => e.target.blur());
for (const b of document.querySelectorAll('#mixer [data-preset]')) b.addEventListener('click', () => setMix(PRESETS[b.dataset.preset]));
$('mixSave').onclick = () => { const it = playingItem(); if (it?.stems) saveMix(it); };
