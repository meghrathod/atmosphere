// Isolated-world content script on disneyplus.com and youtube.com.
// - Injects dec3.js and the site's page script (disney-page.js / youtube-page.js) into the
//   page, passing settings through <html> data attributes.
// - Primes Safari's Dolby Atmos output mode before playback (WebKit bug 331672).
// - Tracks status from the page and answers the toolbar popup.
const SITE = /(^|\.)youtube\.com$/.test(location.hostname) ? 'youtube' : 'disney';
const SITE_NAME = SITE === 'youtube' ? 'YouTube' : 'Disney+';
const DEFAULTS = { requestAtmos: true, prime: true, debug: false, disneyQuality: 'max', disneyRange: 'dv' };
// Extension storage is async, but Disney+ fetches its stream list right at page load.
// Cache settings in the page's localStorage so they're available synchronously at start.
const CACHE_KEY = 'atmosphere-settings';
let settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') }; } catch (e) { /* ignore */ }
const cacheSettings = () => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } };

const state = {
  site: SITE,
  hooks: false,
  requested: false,    // Atmos/4K/HDR added to Disney+'s playback request
  playing: null,       // header of the audio stream currently loaded
  qualityFloor: null,  // heights kept by the Quality setting
  primed: null,        // null | 'ok' | 'failed' | 'off'
  primeSource: null,
  switches: [],
};
const logs = [];
const video = createVideoTracker();

function applySettingsToPage() {
  const d = document.documentElement.dataset;
  d.dolbyDebug = settings.debug ? 'on' : 'off';
  d.dolbyRequest = settings.requestAtmos ? 'on' : 'off';
  d.dolbyQuality = settings.disneyQuality;
  d.dolbyRange = settings.disneyRange;
}
applySettingsToPage();
const settingsReady = browser.storage.local.get(DEFAULTS).then((s) => {
  settings = { ...DEFAULTS, ...s };
  applySettingsToPage();
  cacheSettings();
  if (!settings.prime) state.primed = 'off';
  if (settings.debug) {
    console.info(`[Atmosphere/${SITE_NAME}] Diagnostics active on ${location.hostname}`);
    log('page', 'Diagnostics active on ' + location.hostname + location.pathname);
  }
}).catch(() => {});
browser.storage.onChanged.addListener((changes) => {
  for (const [k, v] of Object.entries(changes)) if (k in DEFAULTS) settings[k] = v.newValue;
  applySettingsToPage();
  cacheSettings();
});

// Page scripts. Disney+: a plain <script src> to the extension file.
// YouTube: its CSP only runs scripts carrying the page's nonce ('strict-dynamic'), and Safari
// silently drops an extension <script src> there. So read the code and inject it inline with
// the nonce of YouTube's first script. YouTube also enforces Trusted Types, so the code goes
// through a policy.
const scriptPolicy = (() => {
  try { return window.trustedTypes ? trustedTypes.createPolicy('atmosphere', { createScriptURL: (u) => u, createScript: (c) => c }) : null; } catch (e) { return null; }
})();
const PAGE_FILES = ['dec3.js', SITE + '-page.js'];
function injectSrc() {
  for (const file of PAGE_FILES) {
    try {
      const s = document.createElement('script');
      const url = browser.runtime.getURL(file);
      s.src = scriptPolicy ? scriptPolicy.createScriptURL(url) : url;
      s.async = false;
      s.onload = () => s.remove();
      s.onerror = () => log('page', `Couldn't load ${file} into the page`);
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      log('page', `Couldn't inject ${file}`, `${e.name}: ${e.message}`);
    }
  }
}
function pageNonce() {
  const find = () => { for (const el of document.querySelectorAll('script')) if (el.nonce) return el.nonce; return ''; };
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => { const n = find(); if (n) { obs.disconnect(); resolve(n); } });
    obs.observe(document, { childList: true, subtree: true });
    setTimeout(() => { obs.disconnect(); resolve(''); }, 5000);
  });
}
async function injectInline() {
  try {
    const [code, nonce] = await Promise.all([
      Promise.all(PAGE_FILES.map((f) => fetch(browser.runtime.getURL(f)).then((r) => r.text()))).then((c) => c.join('\n;\n')),
      pageNonce(),
    ]);
    const s = document.createElement('script');
    if (nonce) s.nonce = nonce;
    s.textContent = scriptPolicy ? scriptPolicy.createScript(code) : code;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
    log('page', `Injected page hooks inline (${nonce ? 'with' : 'without'} page nonce): ${document.documentElement.dataset.atmosHooks || 'not running'}`);
  } catch (e) {
    log('page', "Couldn't inject page hooks", `${e.name}: ${e.message}`);
  }
}
if (SITE === 'youtube') injectInline(); else injectSrc();

// Logs: kept only in Debug mode, shown in the popup and forwarded to the local log sink.
function log(kind, msg, text) {
  if (!settings.debug) return;
  const last = logs[logs.length - 1];
  if (last && last.kind === kind && last.msg === msg) { last.count = (last.count || 1) + 1; last.t = Date.now(); return; }
  logs.push({ t: Date.now(), kind, msg, data: text || null, count: 1 });
  if (logs.length > 200) logs.shift();
  try { browser.runtime.sendMessage({ atmosLog: { site: SITE, kind, msg, text: text ? String(text).slice(0, 4000) : '' } }); } catch (e) { /* ignore */ }
}

const describe = (p) => (p.label || '') + (p.dataRateKbps ? ` ${p.dataRateKbps} kbps` : '');

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data) return;
  if (e.data.__atmosLog) log('page', String(e.data.msg || ''), e.data.text ? String(e.data.text) : '');
  if (!e.data.__atmosEvent) return;
  const { kind, data } = e.data;
  state.hooks = true;
  if (kind === 'requested') state.requested = true;
  if (kind === 'quality') state.qualityFloor = data;
  if (kind === 'audioOpen') { state.playing = null; state.switches = []; video.reset(); }
  if (kind === 'videoOpen') video.setCodec(data);
  if (kind === 'header') {
    const before = state.playing;
    if (before && describe(before) !== describe(data)) {
      const sw = { t: Date.now(), from: describe(before), to: describe(data), lostAtmos: !!before.jocFlag && !data.jocFlag };
      state.switches.push(sw);
      if (state.switches.length > 20) state.switches.shift();
    }
    state.playing = data;
  }
});

function isPlaying() {
  return [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended && v.readyState > 2);
}

// Atmos priming (WebKit bug 331672): Disney+ and YouTube play through MSE, which Safari renders as
// Multichannel unless an Atmos file has played via a plain media element first. Safari
// keeps the mode an audio stream started in, so this must run before playback starts.
const SOURCES = [
  browser.runtime.getURL('prime.mp4'),
  'https://ott.dolby.com/OnDelKits/DDP/Dolby_Digital_Plus_Online_Delivery_Kit_v1.4.1/Test_Signals/muxed_streams/DASH/OnDemand_MPD/Fragment_Audio/ChID_voices_Atmos_6ch_640kbps_ddp_joc.mp4',
];
let priming = false;
async function primeAtmos(reason, force = false) {
  await settingsReady;
  if (priming || (!force && (state.primed === 'ok' || !settings.prime))) return state.primed;
  priming = true;
  let lastErr = '';
  for (const src of SOURCES) {
    const where = src.startsWith('https') ? 'dolby.com' : 'extension';
    try {
      const a = new Audio();
      a.volume = 0.001; // near-silent; fully muted may not engage the Atmos route
      a.src = src;
      await a.play();
      await new Promise((r) => setTimeout(r, 3000));
      a.pause(); a.removeAttribute('src'); a.load();
      state.primed = 'ok';
      state.primeSource = where;
      log('prime', `Primed Safari's Atmos mode (${reason}, ${where} clip)`);
      break;
    } catch (e) {
      lastErr = `${e.name}: ${e.message}`;
    }
  }
  if (state.primed !== 'ok' && !/^page /.test(reason)) {
    state.primed = 'failed';
    log('prime', `Couldn't prime (${reason})`, lastErr);
  }
  priming = false;
  return state.primed;
}
primeAtmos('page start');
window.addEventListener('DOMContentLoaded', () => primeAtmos('page load'), { once: true });
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => primeAtmos('click'), { capture: true });

// Popup API
browser.runtime.onMessage.addListener((m) => {
  if (!m || !m.dolby) return;
  if (m.dolby === 'get') return Promise.resolve({ site: SITE, state: { ...state, active: isPlaying(), video: video.snapshot() }, logs, settings });
  if (m.dolby === 'prime') return primeAtmos('popup', true).then((r) => ({ primed: r }));
  if (m.dolby === 'clear') { logs.length = 0; return Promise.resolve({ ok: true }); }
  if (m.dolby === 'settings') {
    settings = { ...settings, ...m.settings };
    applySettingsToPage();
    cacheSettings();
    if (!settings.debug) logs.length = 0;
    if (!settings.prime && state.primed !== 'ok') state.primed = 'off';
    if (settings.prime && state.primed === 'off') state.primed = null;
    return Promise.resolve({ ok: true });
  }
});
