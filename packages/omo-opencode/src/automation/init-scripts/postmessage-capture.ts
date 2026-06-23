import type { InitScript } from "./types"

const POSTMESSAGE_CAPTURE_SOURCE = `
(function() {
  if (window.__pmCaptureInstalled) return;
  window.__pmCaptureInstalled = true;
  window.__capturedMessageListeners = [];
  window.__capturedOnMessage = { window: null, document: null };

  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (type === 'message') {
      try {
        window.__capturedMessageListeners.push({
          target: this === window ? 'window' : (this === document ? 'document' : (this && this.constructor && this.constructor.name) || 'unknown'),
          listener: listener,
          options: options,
          installedAt: Date.now(),
        });
      } catch (_) { /* ignore */ }
    }
    return origAdd.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (type === 'message') {
      try {
        window.__capturedMessageListeners = window.__capturedMessageListeners.filter(function(c) { return c.listener !== listener; });
      } catch (_) { /* ignore */ }
    }
    return origRemove.call(this, type, listener, options);
  };

  // Capture window.onmessage = fn property assignment (separate channel from addEventListener)
  try {
    var winOnMsgDescriptor = Object.getOwnPropertyDescriptor(window, 'onmessage')
      || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), 'onmessage');
    Object.defineProperty(window, 'onmessage', {
      configurable: true,
      enumerable: true,
      get: function() { return window.__capturedOnMessage.window; },
      set: function(fn) {
        window.__capturedOnMessage.window = typeof fn === 'function' ? fn : null;
        if (winOnMsgDescriptor && winOnMsgDescriptor.set) {
          try { winOnMsgDescriptor.set.call(window, fn); } catch (_) {}
        }
      },
    });
  } catch (_) { /* ignore — some browsers may freeze the property */ }

  window.__deliverSyntheticMessage = function(data, origin, sourceWindow) {
    const targetOrigin = origin || 'https://challenges.cloudflare.com';
    const results = [];
    const buildEvent = function() {
      return new MessageEvent('message', {
        data: data,
        origin: targetOrigin,
        source: sourceWindow || window,
        ports: [],
      });
    };
    const listeners = (window.__capturedMessageListeners || []).slice();
    for (let i = 0; i < listeners.length; i++) {
      const captured = listeners[i];
      try {
        if (typeof captured.listener === 'function') {
          captured.listener.call(window, buildEvent());
          results.push({ ok: true, target: captured.target });
        } else if (captured.listener && typeof captured.listener.handleEvent === 'function') {
          captured.listener.handleEvent(buildEvent());
          results.push({ ok: true, target: captured.target, viaHandleEvent: true });
        } else {
          results.push({ ok: false, target: captured.target, error: 'listener not callable' });
        }
      } catch (e) {
        results.push({ ok: false, target: captured.target, error: String((e && e.message) || e) });
      }
    }
    if (typeof window.__capturedOnMessage.window === 'function') {
      try {
        window.__capturedOnMessage.window.call(window, buildEvent());
        results.push({ ok: true, target: 'window.onmessage' });
      } catch (e) {
        results.push({ ok: false, target: 'window.onmessage', error: String((e && e.message) || e) });
      }
    }
    return results;
  };
})();
`.trim()

export const POSTMESSAGE_CAPTURE_SCRIPT: InitScript = {
  name: "postmessage-capture",
  source: POSTMESSAGE_CAPTURE_SOURCE,
}
