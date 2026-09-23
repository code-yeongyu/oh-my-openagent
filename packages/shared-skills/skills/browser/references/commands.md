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
| `bskSnapshot(session, { interactive, maxDepth })` | `{ tree, refs, css }` — the OmOWright accessibility tree with refs, computed in the page **without** leaving a global or touching the DOM |
| `session.observe({ maxTokens, cursor, probeHover })` | the daemon's semantic tree (`@vom`) with `@eN` refs, layers and hover probes — **the default read for shadow DOM and iframes** |
| `session.snapshot({ maxDepth, maxTokens })` | the daemon's plain accessibility tree |
| `session.getHtml({ ref, maxBytes })` | exact markup |
| `session.screenshot({ ref })` / `screenshot({ fullPage: true })` | `{ buffer, width, height, captureId }`; full-page captures stream back in chunks |
| `session.evaluate(expression, { awaitPromise, timeoutMs })` | `{ ok, value, error }` — **check `.ok`**; a resolved promise does not mean the script succeeded |
| `session.console({ since })` / `session.network({ since })` | buffered console entries / request metadata (no bodies) |

**Refs are reissued by every read.** Read a ref and act on it in the same cycle. A ref captured
two calls ago silently addresses a different element — this is how a click lands on the
neighbouring row.

## Acting

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
await session.tabCreate({ url }); await session.tabSelect(id); await session.tabClose(id)
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
| `permission_denied` | `evaluate` on a tab outside the Agent Window, or a denied borrow | stop; the user said no |
| `timeout` | the tool did not finish in its budget | read the page state before retrying once |
| `user_aborted` | the user pressed Stop in the browser | stop the task and report |
| `cdp_failed` | the page cannot be attached (restricted URL, DevTools open) | say which page and why |

Long calls can be cancelled: `const h = session.client.callWithHandle("tool.navigate", {...})`
then `await session.client.cancel(h.rpcId)`.
