// Finding and pressing the chat client's own controls.
//
// The client is a single-page app: its markup appears some seconds after the page reports itself
// loaded, and a load event is NOT a signal that the chat is on screen. So a control is never queried
// once - the page waits for it to appear, presses it, and reports what it saw if it never did.
// The waiting happens inside the page with a MutationObserver and its own deadline; the host waits
// on one promise rather than asking again and again.

export const START_SELECTORS = ['button[aria-label^="Start huddle"]', 'button[aria-label^="Join huddle"]', 'button[data-qa="huddle_channel_header_button"]'] as const
export const CONFIRM_TEXT = ["start huddle", "join huddle"] as const
export const LEAVE_SELECTORS = ['button[aria-label="Leave Huddle"]', 'button[aria-label^="Leave huddle"]'] as const
export const LEAVE_TEXT = ["leave huddle"] as const

export type ClickResult = {
  readonly clicked: boolean
  readonly how?: string
  readonly candidates: readonly string[]
  readonly title?: string
  readonly buttons?: number
}

export const WAIT_AND_CLICK_SOURCE = `(selectors, texts, timeoutMs) => new Promise((resolve) => {
  var find = function () {
    for (var i = 0; i < selectors.length; i++) {
      var direct = document.querySelector(selectors[i]);
      if (direct !== null) return { node: direct, how: selectors[i] };
    }
    var nodes = document.querySelectorAll("button,[role=button]");
    for (var n = 0; n < nodes.length; n++) {
      var label = ((nodes[n].textContent || "") + " " + (nodes[n].getAttribute("aria-label") || "")).trim().toLowerCase();
      for (var t = 0; t < texts.length; t++) {
        if (label.length > 0 && label.indexOf(texts[t]) >= 0) return { node: nodes[n], how: texts[t] };
      }
    }
    return null;
  };
  var seen = function () {
    var out = [];
    var nodes = document.querySelectorAll("button,[role=button]");
    for (var n = 0; n < nodes.length && out.length < 25; n++) {
      var label = ((nodes[n].getAttribute("aria-label") || "") || (nodes[n].textContent || "")).trim();
      if (label.length > 0) out.push(label.slice(0, 40));
    }
    return out;
  };
  var settled = false;
  var finish = function (hit) {
    if (settled) return;
    settled = true;
    observer.disconnect();
    clearTimeout(timer);
    if (hit === null) {
      resolve({ clicked: false, candidates: seen(), title: document.title, buttons: document.querySelectorAll("button,[role=button]").length });
      return;
    }
    hit.node.click();
    resolve({ clicked: true, how: hit.how, candidates: [] });
  };
  var observer = new MutationObserver(function () {
    var hit = find();
    if (hit !== null) finish(hit);
  });
  var timer = setTimeout(function () { finish(null); }, timeoutMs);
  var immediate = find();
  if (immediate !== null) { finish(immediate); return; }
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label"] });
})`
