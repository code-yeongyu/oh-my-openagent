# Session methods

`connectBrowserSkill()` returns a `BskSession`. Every method is one call on the BrowserSkill
daemon's tool surface; options are the daemon's parameter names in camelCase.

## Sessions

```js
// given: omowright (from the loader in SKILL.md)
const session = await omowright.connectBrowserSkill({ name: "<task>", focused: false, browser: "<instance id>", width: 1200, height: 800 })
session.sessionId            // four letters, e.g. "ckhg"
session.browserInstanceId    // which connected browser owns the Agent Window
// the task's last cell, on success and failure: await session.stop()   (the examples below use this session)
```

`browser` is needed only when more than one browser is connected (`bskDoctor()` lists them).
`focused: false` keeps the Agent Window from stealing focus; drop it only when the user is watching
on purpose. Throws `BskRpcError` `no_browser_connected` when no extension is attached — that is a
stop, not a cue to launch something else.

## Shared control (BrowserSkill 0.5)

The person at the keyboard can work in the task tab while you do, so the extension refuses a gated
page action unless it carries what the latest `session.cooperate("sync")` returned. The daemon
never fills it in for you. Every gated action takes `{ context, observation, expect, dependsOn }`
besides its own options.

A session runs under one control policy, chosen by its first sync and fixed after that (a sync
naming the other policy fails with `invalid_params`; start a new session to change it):

| Action | `strict` (the default) | `target` (`cooperate("sync", { controlPolicy: "target" })`) |
|---|---|---|
| `click`, `hover`, `fill` and the other calls on a ref or selector | a fresh `context` per action | `context`; the same one serves the next DOM action |
| `evaluate` (and so `bskSnapshot`) | a fresh `context` per action | `context` plus an unused `observation`, or `expect` facts, or `unverified: true` |
| `press` with no target, `navigate` | a fresh `context` per action | `context` plus an unused `observation` |
| `dependsOn` | narrows the check to the observed regions your decision used | refused; state facts in `expect` |

```js
// strict: one context, one action
const sync = async () => (await session.cooperate("sync")).context_id
await session.click("@e3", { context: await sync() })
await session.fill("#q", "hello", { clearBefore: true, context: await sync() })

// target: one context for DOM actions, one observation per script, untargeted key or navigate
const s = await session.cooperate("sync", { controlPolicy: "target" })
await session.click("#apply-coupon", { context: s.context_id })
await session.click("#checkout", { context: s.context_id, expect: [{ target: "#total", field: "text", equals: "$3.00" }] })
const next = await session.cooperate("sync")
await session.press("Enter", { context: next.context_id, observation: next.observation_id })
```

| Call | Use |
|---|---|
| `session.cooperate("sync", { controlPolicy, tabId, maxTokens })` | returns `{ context_id, observation_id, ... }`; pass them as `{ context, observation }`. An observation is good for one action |
| `session.cooperate("wait", { tabId, timeoutMs })` | after `cooperation_sync_required`: blocks (at most 25 s per call) until the person is done; repeat until it reports `ready`, then sync and replan from the live page |

- **`expect`** is a list of literal facts the extension checks right before the input:
  `{ target, field, equals }`, where `field` is `text`, `value`, `checked`, `attribute` or `exists`.
  A false fact refuses the action with `effect_state: "none"`, so nothing reached the page. The
  reason differs by policy: under `target` it is `precondition_failed`; under `strict` it is
  `cooperation_sync_required` with a message starting `Precondition failed: <target> <field>`.
  Recognise the strict case by that prefix, and read the page again instead of calling
  `cooperate("wait")`.
  Use it for the fact your decision rests on: the total you are about to pay, the row you are about
  to delete.
- **The first `navigate`** of a session needs no context. If the extension refuses it because the new
  task tab is still committing its blank document, `navigate` waits for the tab to settle and sends
  it once more by itself; it throws only when the tab never settles, naming the tab's state.
- **Gated:** `navigate` (after the first), `back`, `forward`, `reload`, `click`, `hover`, `focus`,
  `blur`, `fill`, `press`, `select`, `scrollTo`, `wheel`, `drag`, `evaluate` (and so
  `bskSnapshot`), `tabClose`, `resize`, `emulate`, `observe({ probeHover: true })`,
  `screenshot({ fullPage: true })`.
- **Not gated:** `observe`, `snapshot`, `getHtml`, `read`, `extract`, `screenshot()`, `console`,
  `network`, `waitForElement`, `waitForNavigation`, `tabList`, `tabCreate`, `tabSelect`,
  `tabBorrow`, `tabReturn`, `requestHelp`.
- A method that reads or acts on a tab accepts only its own options (plus
  `{ context, observation, expect, dependsOn }`);
  any other key (`contextId`, an option copied from another method) throws a `TypeError` before
  anything is sent, plain `observe()` included. Two calls do not throw:
  `screenshot({ fullPage: true })` drops an unknown key and `bskSnapshot` passes it on as a
  snapshot option, so a misspelt `contextId` there sends no context and the daemon refuses the
  call with `cooperation_sync_required`.
- Never replay a refused action blindly: the page may have changed under the person's hands.

## Targets

| Form | Meaning |
|---|---|
| `"@e3"` / `"e3"` | a ref from the last `observe()` / `snapshot()` |
| `"#login > button"` | a CSS selector, resolved live in the main document; a gated action refuses one that matches more than one element (`invalid_params`, `target_unavailable`) |
| `{ captureId, x, y }` | a point in a screenshot, from `screenshot()`; `click` only. `captureId` is `null` when the daemon reports `captureUnavailable`; use a ref or selector then |
| `css.e3` from `bskSnapshot` | the light-DOM CSS path of an OmOWright ref (`null` inside shadow roots — use the daemon ref instead) |

## Reading

| Call | Returns |
|---|---|
| `bskSnapshot(session, { interactive, maxDepth, context })` | `{ tree, refs, css }` — the OmOWright accessibility tree with refs, computed in the page **without** leaving a global or touching the DOM |
| `session.observe({ maxTokens, cursor, probeHover })` | the daemon's semantic tree (`@vom`) with `@eN` refs, layers and hover probes — **the default read for shadow DOM and iframes** |
| `session.snapshot({ maxDepth, maxTokens })` | the daemon's plain accessibility tree |
| `session.read(target, { fields, maxNodes })` | `{ items: [{ ref, values: { text, ... } }], page_url, title }` for the matching nodes, with no script and no context; `items` is empty when nothing matches. Each field is an object: `fields: [{ key: "href", read: "attribute", attribute: "href" }]` puts the link's `href` in `values.href` (`read` is `text`, `attribute`, `value`, `checked` or `exists`) |
| `session.extract("table" \| "list" \| "discover", { target, itemSelector, fields })` | rows of a table or list |
| `session.getHtml({ ref, maxBytes })` | exact markup |
| `session.screenshot({ ref })` / `screenshot({ fullPage: true })` | `{ buffer, width, height, captureId }`; full-page captures stream back in chunks |
| `session.evaluate(expression, { awaitPromise, timeoutMs, unverified, context })` | `{ ok, value, error }` — **check `.ok`**; a resolved promise does not mean the script succeeded |

Prefer `read` or `extract` to `evaluate` whenever the answer is already in the DOM (a heading, an
input's value, a link's `href`, a table): they need no sync, cannot change the page, and pass the
field traps below. Keep `evaluate` for values the page computes (`location.href`, layout, app
state) and for waiting on a state that `waitForElement` cannot express.
| `session.console({ since })` / `session.network({ since })` | buffered console entries / request metadata (no bodies) |

**Refs are reissued by every read.** Read a ref and act on it in the same cycle. A ref captured
two calls ago silently addresses a different element — this is how a click lands on the
neighbouring row.

## Acting

Every call here except `waitForElement()` and `waitForNavigation()` is gated: add `context` (from `cooperate("sync")`) to its options object, as in
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
| Drag | `session.drag(source, { target, delta: { x, y }, mode })` |
| Wheel | `session.wheel({ deltaY: 600, target })` |
| Focus / blur | `session.focus(target)` / `session.blur(target)` |
| Navigate | `session.navigate(url, { waitUntil: "load" \| "domcontentloaded" \| "networkidle" \| "commit", timeoutMs })`, `back()`, `forward()`, `reload({ hard })`, `waitForNavigation()` |
| Window | `session.resize(width, height)`, `session.emulate({ overrides: { width, mobile } })` |

Waiting is never a fixed delay: `navigate(url, { waitUntil: "networkidle" })` for a page that renders
after load, `waitForNavigation()` after an action that navigates,
`waitForElement(target, { state: "visible" | "hidden" | "attached" | "detached", timeoutMs })` for an
element, and for any other state `evaluate("new Promise((done) => { /* resolve when the state holds */ })", { awaitPromise: true, timeoutMs, context })`.

Traps:

- `select` takes the option's **value attribute**, not its visible label.
- `press` without `target` goes to the focused node; `press` with a CSS selector is fine, but a
  daemon ref must come from the current read.
- A menu that a `click` opens can be toggled shut by that same click. `focus` then `press("Enter")`
  opens it reliably.
- Hover-only controls report `element not visible`: hover the trigger, read again, then act on the
  revealed item's fresh ref. `observe({ probeHover: true })` finds one when no marker does, at the
  cost of touching the live page.

### Field traps in any Chromium-based browser

- **A frame injected by another extension** (a password manager, a translator, a grammar checker)
  can make the debugger refuse the whole tab. It is usually transient: do
  the work in one `evaluate`, or navigate away and back, then read again.
- **A control inside another extension's own frame can never be driven.** Its frame belongs to that
  extension, not to the page. Hand that click to the person with `requestHelp`.
- **Clipboard writes fail in an unfocused Agent Window**, and `focused: false` is the default you
  should keep. Read the value out of the DOM with `read` instead of copying it.

## Tabs

```js
// given: tabId, url, id (a tab id from tabs, the URL to open, the id tabCreate returned)
const { tabs } = await session.tabList({ scope: "user" })   // "user" | "agent" | "all"
await session.tabBorrow(tabId)                                // the user confirms in the browser (60 s)
await session.tabReturn(tabId)                                // stop() returns anything still borrowed
await session.tabCreate({ url }); await session.tabSelect(id); await session.tabClose(id, { context: await sync() })
```

Never invent tab ids and never repeat a denied borrow.

## Humans

```js
const flag = `${(await import("node:os")).tmpdir()}/help-${Date.now()}.flag`
await tool.monitor({ description: "help finished", path: flag, event: "create" })   // subscribe first
globalThis.help = session.requestHelp({ prompt: "Please finish the sign-in, then continue.", targets: ["@e4"], timeoutMs: 300_000 })   // optional: title, completionCriteria
  .then((r) => Bun.write(flag, r.outcome), (e) => Bun.write(flag, `failed: ${e.message}`))
// outcome: "completed" | "continued" | "cancelled" | "timed_out" | "navigated" | "disabled"
```

Never `await` it in an eval cell: a person takes longer than a cell (SKILL.md rule 2).

## Errors

Every refusal is a `BskRpcError` with the daemon's own `code`:

| `code` | Meaning | Do |
|---|---|---|
| `no_browser_connected` | no extension attached | run the onboarding script, relay the human step, wait |
| `not_found` | stale ref or unknown session | read again; if the session is gone, start a new one |
| `invalid_params` | wrong option shape | fix the call, do not retry as-is |
| `permission_denied` with `data.reason: "cooperation_sync_required"` (any other message) | a gated action without the latest sync context, or the person is using the tab | `cooperate("wait")` until `ready`, sync, read the page again, replan |
| `permission_denied` with `data.reason: "precondition_failed"` (target), or `cooperation_sync_required` with a message starting `Precondition failed:` (strict) | an `expect` fact was false; nothing was sent | read the page again and decide afresh |
| `permission_denied` with `data.reason: "observation_required"` | target policy: a script, an untargeted key or a navigate with no observation, or with one already used | sync, pass `{ context, observation }` (or `expect` for a script) |
| `permission_denied` with `data.reason: "observation_changed"` | target policy: the page changed between the sync and this action | sync again, read, replan |
| `data.reason: "control_context_invalid"` | the keyboard focus changed since the sync | sync again, read, replan |
| `permission_denied` (any other reason) | `evaluate` on a tab outside the Agent Window, or a denied borrow | stop; the user said no |
| `timeout` | the tool did not finish in its budget | read the page state before retrying once |
| `user_aborted` | the user pressed Stop in the browser | stop the task and report |
| `cdp_failed` | the page cannot be attached (restricted URL, DevTools open) | say which page and why |

Inside OmO Desktop (`OMO_BROWSER_ENGINE` set), `connectBuiltinBrowser()` throws `BuiltinBrowserUnavailableError` (`code` `browser_builtin_unavailable`). Reasons `unavailable`, `timeout`, and `invalid_grant` mean the built-in browser is unavailable; `invalid_grant` includes a missing or unreadable token file. For `user_stopped` or any other app refusal, stop browser work and report it without opening another browser. Refresh uses the new grant's endpoint and token together; every other call behaves as in the terminal.

Long calls can be cancelled: `const h = session.client.callWithHandle("tool.navigate", {...})`
then `await session.client.cancel(h.rpcId)`.
