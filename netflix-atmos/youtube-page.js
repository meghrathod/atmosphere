// YouTube (page world). YouTube serves Dolby 5.1 audio on many videos (itag 328 E-AC-3 and
// 380 AC-3, 6 channels; YouTube has no Atmos/JOC streams), but its web player only offers them
// when the browser passes a multichannel check first:
//   isTypeSupported('audio/webm; codecs="opus"; channels=2')  must be true, and
//   isTypeSupported('audio/webm; codecs="opus"; channels=99') must be false.
// TV browsers answer that; desktop Safari ignores the "channels" parameter, so YouTube never
// enables AC-3/E-AC-3. We answer it the way a multichannel-capable browser would: drop the
// parameter and reject channel counts above 8. Nothing else about the request changes.
(() => {
  document.documentElement.dataset.atmosHooks = 'started';
  const TAG = '[Atmosphere/YouTube]';
  const d = () => document.documentElement.dataset;
  const enabled = () => d().dolbyRequest !== 'off';
  const seen = new Set();
  const event = (kind, data) => {
    try { window.postMessage({ __atmosEvent: true, kind, data }, location.origin); } catch (e) { /* ignore */ }
  };
  const log = (msg, data, key) => {
    if (d().dolbyDebug !== 'on') return;
    if (key) { if (seen.has(key)) return; seen.add(key); }
    const text = data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data);
    console.info(`${TAG} ${msg}${text ? ' :: ' + text : ''}`);
    try { window.postMessage({ __atmosLog: true, msg, text }, location.origin); } catch (e) { /* ignore */ }
  };

  const MAX_CHANNELS = 8;
  let announced = false;
  function wrapIsTypeSupported(Ctor) {
    if (!Ctor || !Object.prototype.hasOwnProperty.call(Ctor, 'isTypeSupported')) return;
    const orig = Ctor.isTypeSupported.bind(Ctor);
    Ctor.isTypeSupported = function (type) {
      const t = String(type);
      const m = enabled() && /^audio\//i.test(t) && t.match(/;\s*channels=(\d+)/i);
      if (!m) {
        const r = orig(type);
        if (/ec-3|ac-3/i.test(t)) log('isTypeSupported', { type: t, result: r }, 'its:' + t);
        return r;
      }
      const n = parseInt(m[1], 10);
      const r = n >= 1 && n <= MAX_CHANNELS && orig(t.replace(/;\s*channels=\d+/i, ''));
      if (!announced && n <= MAX_CHANNELS && r) {
        announced = true;
        event('requested', { channels: true });
        log('Answered YouTube\'s multichannel check: Dolby 5.1 formats enabled');
      }
      log('isTypeSupported (channels)', { type: t, result: r }, 'its:' + t);
      return r;
    };
  }
  wrapIsTypeSupported(window.MediaSource);
  wrapIsTypeSupported(window.ManagedMediaSource);

  // Status: which audio/video the player actually opens.
  const MS = window.ManagedMediaSource || window.MediaSource;
  const protos = [...new Set([window.MediaSource, window.ManagedMediaSource].filter(Boolean).map((C) => C.prototype))];
  for (const proto of protos) {
    if (!Object.prototype.hasOwnProperty.call(proto, 'addSourceBuffer')) continue;
    const origAdd = proto.addSourceBuffer;
    proto.addSourceBuffer = function (type) {
      const sb = origAdd.call(this, type);
      sb.__atmosType = type;
      const audio = /^audio\//i.test(type);
      event(audio ? 'audioOpen' : 'videoOpen', type);
      // YouTube's stereo audio is Opus in WebM, which has no MP4 header to read.
      if (audio && /opus/i.test(type)) event('header', { codec: 'opus', channels: 2, label: 'Opus stereo', sampleEntry: 'webm' });
      log('Opened SourceBuffer', type);
      return sb;
    };
  }
  if (MS && window.SourceBuffer) {
    const origAppend = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      try {
        if (/^audio\/mp4/i.test(this.__atmosType || '') && typeof __dolbyInspectInit === 'function') {
          const info = __dolbyInspectInit(data);
          if (info) {
            event('header', info);
            log('Audio stream header: ' + info.label + (info.dataRateKbps ? ` (${info.dataRateKbps} kbps)` : ''), info, 'hdr:' + info.label + info.dataRateKbps);
          }
        }
      } catch (e) { /* ignore */ }
      return origAppend.call(this, data);
    };
  }

  document.documentElement.dataset.atmosHooks = 'installed';
  event('hooks');
  log('Hooks installed');
})();
