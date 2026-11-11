# Session methods

`connectBrowserSkill()` returns a `BskSession`. Every method is one call on the BrowserSkill
daemon's tool surface; options are the daemon's parameter names in camelCase.

## Sessions

```js
const session = await omowright.connectBrowserSkill({ name: "<task>", focused: false, browser: "<instance id>", width: 1200, height: 800 })
session.sessionId            // four letters, e.g. "ckhg"
session.browserInstanceId    // which connected browser owns the Agent Window
await session.stop()         // ALWAYS, on success and failure
```

`browser` is needed only when more than one browser is connected (`bskDoctor()` lists them).
`focused: false` keeps the Agent Window from stealing focus; drop it only when the user is watching
on purpose. Throws `BskRpcError` `no_browser_connected` when no extension is attached — that is a
stop, not a cue to launch something else.

## Shared control (BrowserSkill 0.4+)

The person at the keyboard can work in the task tab while you do, so the extension refuses every
gated page action with `permission_denied` / `data.reason: "cooperation_sync_required"` unless it
carries the `context_id` of the latest `session.cooperate("sync")`. The daemon never fills it in
for you.

```js
const sync = async () => (await session.cooperate("sync")).context_id
await session.click("@e3", { context: await sync() })                 // one context, one action
await session.fill("#q", "hello", { clearBefore: true, context: await sync() })
```

| Call | Use |
|---|---|
| `session.cooperate("sync", { tabId, maxTokens })` | returns `{ context_id, ... }`; pass it as `{ context }` to the next gated action, then sync again |
| `session.cooperate("wait", { tabId, timeoutMs })` | after `cooperation_sync_required`: blocks (at most 25 s per call) until the person is done; repeat until it reports `ready`, then sync and replan from the live page |

- **Gated** (need `{ context }`): `navigate` (except the first navigation of the untouched blank tab),
  `back`, `forward`, `reload`, `click`, `hover`, `focus`, `blur`, `fill`, `press`, `select`,
  `scrollTo`, `wheel`, `evaluate` (and so `bskSnapshot`), `tabClose`, `resize`, `emulate`,
  `observe({ probeHover: true })`, `screenshot({ fullPage: true })`.
- **Not gated:** `observe`, `snapshot`, `getHtml`, `screenshot()`, `console`, `network`,
  `waitForNavigation`, the tab list/borrow/return calls, `requestHelp`.
- `dependsOn: ["@e2", ...]` narrows the check to the observed regions your decision used.
- A gated action accepts only its own options plus `{ context, dependsOn }`; any other key
  (`contextId`, a stray option copied from another method) throws a `TypeError` before anything is
  sent. Two exceptions: `bskSnapshot` and `screenshot({ fullPage: true })` pass unknown keys
  through instead of throwing, so a misspelt `contextId` there sends no context and the daemon
  refuses the call with `cooperation_sync_required`.
- Never replay a refused action blindly: the page may have changed under the person's hands.

## Targets

| Form | Meaning |
|---|---|
| `"@e3"` / `"e3"` | a ref from the last `observe()` / `snapshot()` |
| `"#login > button"` | a CSS selector, resolved live |
| `{ captureId, x, y }` | a point in a screenshot, from `screenshot()` |
| `css.e3` from `bskSnapshot` | the light-DOM CSS path of an OmOWright ref (`null` inside shadow roots — use the daemon ref instead) |

## Reading

| Call | Returns |
|---|---|
| `bskSnapshot(session, { interactive, maxDepth, context })` | `{ tree, refs, css }` — the OmOWright accessibility tree with refs, computed in the page **without** leaving a global or touching the DOM |
| `session.observe({ maxTokens, cursor, probeHover })` | the daemon's semantic tree (`@vom`) with `@eN` refs, layers and hover probes — **the default read for shadow DOM and iframes** |
| `session.snapshot({ maxDepth, maxTokens })` | the daemon's plain accessibility tree |
| `session.getHtml({ ref, maxBytes })` | exact markup |
| `session.screenshot({ ref })` / `screenshot({ fullPage: true })` | `{ buffer, width, height, captureId }`; full-page captures stream back in chunks |
| `session.evaluate(expression, { awaitPromise, timeoutMs, context })` | `{ ok, value, error }` — **check `.ok`**; a resolved promise does not mean the script succeeded |
| `session.console({ since })` / `session.network({ since })` | buffered console entries / request metadata (no bodies) |

**Refs are reissued by every read.** Read a ref and act on it in the same cycle. A ref captured
two calls ago silently addresses a different element — this is how a click lands on the
neighbouring row.

## Acting

Every call here is gated: add `context` (from `cooperate("sync")`) to its options object, as in
`session.click(target, { context })`, `session.resize(width, height, { context })`,
`session.tabClose(id, { context })`.

| Need | Call |
|---|---|
| Click | `session.click(target, { button, clickCount, modifiers })` |
| Fill | `session.fill(target, value, { clearBefore })` |
| Select | `session.select(target, ["<option value>"])` |
| Key | `session.press("Enter", { target, modifiers, holdMs })` |
| Hover | `session.hover(target, { settleMs })` |
| Scroll into view | `session.scrollTo(target)` |
| Wheel | `session.wheel({ deltaY: 600, target })` |
| Focus / blur | `session.focus(target)` / `session.blur(target)` |
| Navigate | `session.navigate(url, { waitUntil: "load" \| "domcontentloaded" \| "networkidle" \| "commit", timeoutMs })`, `back()`, `forward()`, `reload({ hard })`, `waitForNavigation()` |
| Window | `session.resize(width, height)`, `session.emulate({ overrides: { width, mobile } })` |

Traps:

- `select` takes the option's **value attribute**, not its visible label.
- `press` without `target` goes to the focused node; `press` with a CSS selector is fine, but a
  daemon ref must come from the current read.
- A menu that a `click` opens can be toggled shut by that same click. `focus` then `press("Enter")`
  opens it reliably.
- Hover-only controls report `element not visible`: hover the trigger, read again, then act on the
  revealed item's fresh ref. `observe({ probeHover: true })` finds one when no marker does, at the
  cost of touching the live page.
- The clipboard is unavailable in a window started `focused: false`, so read values out of the DOM.

## Tabs

```js
const { tabs } = await session.tabList({ scope: "user" })   // "user" | "agent" | "all"
await session.tabBorrow(tabId)                                // the user confirms in the browser (60 s)
await session.tabReturn(tabId)                                // stop() returns anything still borrowed
await session.tabCreate({ url }); await session.tabSelect(id); await session.tabClose(id, { context: await sync() })
```

Never invent tab ids and never repeat a denied borrow.

## Humans

```js
const { outcome } = await session.requestHelp({ prompt, title, targets: ["@e4"], completionCriteria, timeoutMs })
// outcome: "completed" | "continued" | "cancelled" | "timed_out" | "navigated" | "disabled"
```

## Errors

Every refusal is a `BskRpcError` with the daemon's own `code`:

| `code` | Meaning | Do |
|---|---|---|
| `no_browser_connected` | no extension attached | run the onboarding script, relay the human step, wait |
| `not_found` | stale ref or unknown session | read again; if the session is gone, start a new one |
| `invalid_params` | wrong option shape | fix the call, do not retry as-is |
| `permission_denied` with `data.reason: "cooperation_sync_required"` | a gated action without the latest sync context, or the person is using the tab | `cooperate("wait")` until `ready`, sync, read the page again, replan |
| `permission_denied` (any other reason) | `evaluate` on a tab outside the Agent Window, or a denied borrow | stop; the user said no |
| `timeout` | the tool did not finish in its budget | read the page state before retrying once |
| `user_aborted` | the user pressed Stop in the browser | stop the task and report |
| `cdp_failed` | the page cannot be attached (restricted URL, DevTools open) | say which page and why |

Inside OmO Desktop (`OMO_BROWSER_ENGINE` set), `connectBuiltinBrowser()` throws `BuiltinBrowserUnavailableError` (`code` `browser_builtin_unavailable`). Reasons `unavailable`, `timeout`, and `invalid_grant` mean the built-in browser is unavailable; `invalid_grant` includes a missing or unreadable token file. For `user_stopped` or any other app refusal, stop browser work and report it without opening another browser. Refresh uses the new grant's endpoint and token together; every other call behaves as in the terminal.

Long calls can be cancelled: `const h = session.client.callWithHandle("tool.navigate", {...})`
then `await session.client.cancel(h.rpcId)`.
