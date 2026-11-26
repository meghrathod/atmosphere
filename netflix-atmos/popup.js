// Atmosphere popup. Shows live status from the active Netflix / Disney+ / YouTube tab.
// Opened outside Safari (no extension API) it renders demo data: popup.html?site=disney
const api = globalThis.browser;
const $ = (id) => document.getElementById(id);
const DEFAULTS = { requestAtmos: true, prime: true, debug: false, disneyQuality: 'max', disneyRange: 'dv' };
const time = (t) => new Date(t).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

let tabId = null;
let lastLogs = [];

// ---------- demo data (preview outside Safari) ----------
const DEMO_SITE = new URLSearchParams(location.search).get('site') || 'netflix';
const DEMO = {
  site: DEMO_SITE,
  settings: { ...DEFAULTS, debug: true },
  state: {
    hooks: true, requested: true, active: true,
    playing: { jocFlag: 1, dataRateKbps: 768, complexityIndex: 16, channels: 6, codec: 'eac3', label: 'Dolby Atmos', sampleEntry: 'ec-3 (clear)' },
    primed: 'ok', primeSource: 'extension',
    switches: [{ t: Date.now() - 9000, from: 'Dolby Digital Plus 5.1 448 kbps', to: 'Dolby Atmos 768 kbps' }],
    video: { width: 3840, height: 2160, label: '4K', codec: DEMO_SITE === 'disney' ? 'dvh1.05.06' : 'hvc1.2.4.L153.B0',
      range: DEMO_SITE === 'disney' ? 'Dolby Vision' : 'HDR10', format: 'HEVC', dropped: 12, total: 4210,
      switches: [{ t: Date.now() - 6000, from: '480p', to: '4K' }] },
  },
  logs: [
    { t: Date.now() - 9000, kind: 'prime', msg: "Primed Safari's Atmos mode (page start, extension clip)" },
    { t: Date.now() - 8000, kind: 'header', msg: 'Audio: Dolby Atmos (768 kbps)' },
  ],
};

// ---------- tab messaging ----------
async function activeTab() {
  if (!api) return null;
  try { const [tab] = await api.tabs.query({ active: true, currentWindow: true }); return tab || null; } catch { return null; }
}
async function send(msg) {
  if (!api) return msg.dolby === 'get' ? DEMO : {};
  if (tabId == null) { const tab = await activeTab(); tabId = tab ? tab.id : null; }
  if (tabId == null) throw new Error('no tab');
  return api.tabs.sendMessage(tabId, msg);
}

// ---------- site theming ----------
const SITES = {
  netflix: { name: 'Netflix', theme: '', toggle: 'Dolby Atmos', desc: 'Request Atmos' },
  disney: { name: 'Disney+', theme: 'theme-disney', toggle: 'Dolby Atmos', desc: 'Request Atmos, 4K and HDR' },
  youtube: { name: 'YouTube', theme: 'theme-youtube', toggle: 'Dolby 5.1', desc: 'Use Dolby surround when a video has it' },
};
function applySite(site) {
  const s = SITES[site];
  document.body.className = s ? s.theme : '';
  $('site').textContent = s ? s.name : '';
  if (s) { $('requestDesc').textContent = s.desc; $('requestName').textContent = s.toggle; }
  $('disneySettings').hidden = site !== 'disney';
}

// Original badge designs (Dolby's own logos are licensed trademarks, so they aren't used).
const DOME = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 11.5a5.5 5.5 0 0 1 11 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M1.5 12.6h13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="11.6" cy="6.3" r="1.6" fill="#fff6c8"/></svg>';
function chip(cls, text, html) {
  const el = document.createElement('span');
  el.className = 'chip ' + cls;
  if (html) el.innerHTML = html;
  el.append(text);
  return el;
}
// Brand logos are fetched locally (tools/fetch-brand-logos.sh) and never committed.
// If a file is missing, the element falls back to the original badge/text.
function brandLogo(file, alt, fallback) {
  const img = document.createElement('img');
  img.src = `brand/${file}`;
  img.alt = alt;
  img.className = 'brand-logo';
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}
function logoChip(cls, file, alt, fallback) {
  const el = document.createElement('span');
  el.className = 'chip logo ' + cls;
  el.append(brandLogo(file, alt, () => { const f = fallback(); el.replaceWith(f); return document.createTextNode(''); }));
  return el;
}
const visionChip = () => { const c = chip('vision', 'VISION'); c.prepend(Object.assign(document.createElement('i'), { className: 'spectrum' })); return c; };
function videoChips(v) {
  const out = [];
  if (!v || !v.height) return out;
  out.push(chip('res', v.label));
  if (v.range === 'Dolby Vision') out.push(logoChip('vision', 'dolby-vision.svg', 'Dolby Vision', visionChip));
  else if (v.range === 'HDR10') out.push(chip('', 'HDR10'));
  return out;
}
function audioChips(p) {
  if (!p || p.tentative) return [];
  if (p.jocFlag) return [logoChip('atmos', 'dolby-atmos.svg', 'Dolby Atmos', () => chip('atmos', 'ATMOS', DOME))];
  if (p.channels >= 6) return [chip('', ({ eac3: 'DD+ 5.1', ac3: 'DD 5.1' })[p.codec] || '5.1')];
  if (p.channels) return [chip('', 'STEREO')];
  return [];
}

// A row shows badges when there are any, otherwise a short text.
function setRow(id, cls, text, makeChips, key) {
  $(id).className = 'row ' + cls;
  const b = $(id).querySelector('b');
  const k = (key || '') + '|' + text;
  if (b.dataset.key === k) return; // avoid re-creating images every second
  b.dataset.key = k;
  const chips = makeChips ? makeChips() : [];
  b.className = chips.length ? 'chips-inline' : '';
  if (chips.length) b.replaceChildren(...chips); else b.textContent = text;
}

// ---------- render ----------
function render({ site = 'netflix', state, logs, settings }) {
  applySite(site);
  $('t-request').checked = settings.requestAtmos;
  $('t-prime').checked = settings.prime;
  $('t-debug').checked = !!settings.debug;
  $('logs').hidden = !settings.debug;

  if (state.offline) {
    setRow('row-audio', '', 'Reload the page for live status');
    setRow('row-video', '', '—');
    $('row-audio').querySelector('b').classList.add('hint');
    renderStats(site, state, settings);
    renderLogs([]);
    return;
  }

  const p = state.playing;
  const v = state.video || {};
  const live = !!state.active;
  const atmos = !!(p && p.jocFlag && !p.tentative);

  // Audio row
  if (!p) setRow('row-audio', '', live ? 'Waiting for audio…' : 'Nothing playing');
  else if (p.tentative && p.codec === 'eac3') setRow('row-audio', '', 'Dolby Digital Plus · checking…');
  else setRow('row-audio', atmos || (site === 'youtube' && /^(ac3|eac3)$/.test(p.codec)) ? 'ok' : 'warn', p.label || 'Unknown', () => audioChips(p), JSON.stringify([p.jocFlag, p.channels]));

  // Video row
  const videoText = v.height ? [v.label, v.range && v.range !== 'SDR' ? v.range : ''].filter(Boolean).join(' ') : '';
  setRow('row-video', v.height ? (v.height >= 1080 ? 'ok' : 'warn') : '', videoText || (live ? 'Waiting for video…' : 'Nothing playing'),
    () => videoChips(v), JSON.stringify([v.label, v.range]));

  $('subline').textContent = '';

  renderStats(site, state, settings);
  renderLogs(logs);
}

function renderStats(site, state, settings) {
  const p = state.playing;
  const v = state.video || {};
  const rows = [];
  const add = (k, val) => { if (val !== undefined && val !== null && val !== '') rows.push([k, String(val)]); };
  const sep = () => rows.push(null);

  if (state.offline) add('Status', 'not connected: reload the page');
  add('Request', state.requested ? (site === 'youtube' ? 'Dolby 5.1 enabled' : 'Atmos added') : settings.requestAtmos ? (site === 'youtube' ? 'waiting for a video' : 'waiting for a title') : 'off');
  sep();
  if (p) {
    add('Audio', p.label);
    add('Codec', [p.codec, p.sampleEntry].filter(Boolean).join(' · '));
    add('Bitrate', p.dataRateKbps ? `${p.dataRateKbps} kbps` : '');
    add('Channels', p.channels ? `${p.channels}${p.jocFlag ? ' + objects (JOC)' : ''}` : '');
    if (p.complexityIndex) add('Complexity', p.complexityIndex);
    const sw = (state.switches || []).slice(-1)[0];
    if (sw) add('Changed', `${time(sw.t)} from ${sw.from}`);
  } else add('Audio', 'nothing playing');
  sep();
  if (v.height) {
    add('Video', `${v.label} · ${v.width}×${v.height}`);
    add('Format', [v.range, v.format].filter(Boolean).join(' · '));
    add('Codec', v.codec);
    if (v.total) add('Dropped', `${v.dropped} of ${v.total} frames`);
    const vsw = (v.switches || []).slice(-1)[0];
    if (vsw) add('Changed', `${time(vsw.t)} from ${vsw.from}${v.switches.length > 1 ? ` (${v.switches.length}×)` : ''}`);
  } else add('Video', 'nothing playing');
  if (site === 'disney') add('Quality', ({ max: 'Highest', auto: 'Auto' })[settings.disneyQuality] || `${settings.disneyQuality}p floor`);
  sep();
  add('Atmos mode', state.primed === 'ok' ? `primed (${state.primeSource} clip)`
    : state.primed === 'failed' ? 'blocked by autoplay: use Prime now'
    : state.primed === 'off' ? 'priming off' : 'primes on page load');

  $('stats').replaceChildren(...rows.flatMap((r) => {
    if (!r) { const d = document.createElement('div'); d.className = 'sep'; return [d]; }
    const dt = document.createElement('dt'); dt.textContent = r[0];
    const dd = document.createElement('dd'); dd.textContent = r[1];
    return [dt, dd];
  }));
}

function renderLogs(logs) {
  lastLogs = logs || [];
  $('logCount').textContent = lastLogs.length;
  const ul = $('logList');
  const atBottom = ul.scrollTop + ul.clientHeight >= ul.scrollHeight - 4;
  ul.replaceChildren(...(lastLogs.length ? lastLogs : [null]).map((l) => {
    const li = document.createElement('li');
    if (!l) { li.className = 'empty'; li.textContent = 'No events yet'; return li; }
    const t = document.createElement('time'); t.textContent = time(l.t);
    const msg = document.createElement('span'); msg.className = 'msg';
    msg.textContent = l.msg + (l.count > 1 ? `  ×${l.count}` : '');
    li.append(t, msg);
    return li;
  }));
  if (atBottom) ul.scrollTop = ul.scrollHeight;
}

// Couldn't reach the tab's content script. On a supported site that happens when the page was
// open before Atmosphere was installed or updated; show the normal view (settings still work)
// with a reload hint. On other websites, show only the brand and one line.
async function showOffline() {
  const tab = await activeTab();
  const url = (tab && tab.url) || '';
  const site = /^https:\/\/www\.netflix\.com\//.test(url) ? 'netflix' : /^https:\/\/([a-z0-9-]+\.)*disneyplus\.com\//.test(url) ? 'disney'
    : /^https:\/\/www\.youtube\.com\//.test(url) ? 'youtube' : null;
  if (site) {
    let settings = DEFAULTS;
    if (api) { try { settings = await api.storage.local.get(DEFAULTS); } catch { /* ignore */ } }
    render({ site, state: { offline: true }, logs: [], settings });
    return;
  }
  applySite(null);
  document.body.classList.add('idle');
  $('subline').textContent = 'Open Netflix, Disney+ or YouTube to start';
}

async function refresh() {
  try { render(await send({ dolby: 'get' })); } catch { tabId = null; await showOffline(); }
}

// ---------- settings ----------
async function saveToggles() {
  const settings = { requestAtmos: $('t-request').checked, prime: $('t-prime').checked, debug: $('t-debug').checked };
  if (api) await api.storage.local.set(settings);
  try { await send({ dolby: 'settings', settings }); } catch { /* not on a supported tab */ }
  refresh();
}
for (const id of ['t-request', 't-prime', 't-debug']) $(id).addEventListener('change', saveToggles);

const QDESC = {
  max: 'Best resolution the title has, within seconds',
  auto: "Disney+'s own choice (starts low)",
  2160: '4K, or the best the title has', 1440: 'At least 1440p', 1080: 'At least 1080p', 720: 'At least 720p',
};
function saveVideo() {
  $('qualityDesc').textContent = QDESC[$('s-quality').value] || '';
  if (api) api.storage.local.set({ disneyQuality: $('s-quality').value, disneyRange: $('s-range').value });
}
$('s-quality').addEventListener('change', saveVideo);
$('s-range').addEventListener('change', saveVideo);

$('primeNow').addEventListener('click', async () => {
  const b = $('primeNow');
  b.disabled = true; b.textContent = 'Priming…';
  try { await send({ dolby: 'prime' }); } catch { /* ignore */ }
  b.disabled = false; b.textContent = 'Prime now';
  refresh();
});

$('copy').addEventListener('click', async (e) => {
  e.preventDefault();
  const text = lastLogs.map((l) => `${new Date(l.t).toISOString()} [${l.kind}] ${l.msg}` + (l.count > 1 ? ` x${l.count}` : '') +
    (l.data ? ' ' + (typeof l.data === 'string' ? l.data : JSON.stringify(l.data)) : '')).join('\n');
  try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Failed'; }
  setTimeout(() => (e.target.textContent = 'Copy'), 1200);
});
$('clear').addEventListener('click', async (e) => {
  e.preventDefault();
  try { await send({ dolby: 'clear' }); } catch { /* ignore */ }
  refresh();
});

// Stats for nerds: toggled with a class; CSS animates the height. Remembered per viewer.
function setNerds(open) {
  $('nerds').classList.toggle('open', open);
  $('nerdsToggle').setAttribute('aria-expanded', String(open));
  $('nerdsWrap').inert = !open;
}
try { setNerds(localStorage.getItem('atmosphere-nerds') === '1'); } catch { setNerds(false); }
$('nerdsToggle').addEventListener('click', () => {
  const open = !$('nerds').classList.contains('open');
  setNerds(open);
  try { localStorage.setItem('atmosphere-nerds', open ? '1' : '0'); } catch { /* ignore */ }
});

// ---------- start ----------
// Safari auto-focuses the first focusable element when the popup opens; clear it.
const clearFocus = () => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); };
clearFocus();
requestAnimationFrame(clearFocus);
setTimeout(clearFocus, 50);
(async () => {
  let s = DEFAULTS;
  if (api) { try { s = await api.storage.local.get(DEFAULTS); } catch { /* ignore */ } }
  $('t-request').checked = s.requestAtmos;
  $('t-prime').checked = s.prime;
  $('t-debug').checked = s.debug;
  $('logs').hidden = !s.debug;
  $('s-quality').value = s.disneyQuality;
  $('s-range').value = s.disneyRange;
  $('qualityDesc').textContent = QDESC[s.disneyQuality] || '';
  refresh();
  setInterval(refresh, 1000);
})();
