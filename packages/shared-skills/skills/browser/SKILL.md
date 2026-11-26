---
name: browser
description: "Drives a real browser through the omowright library from the js eval kernel: sites the user is already signed into, forms and clicks, JS-rendered pages, screenshots, web QA, extension popups, a human handoff for login, CAPTCHA or OTP, and a browser you own for scraping, bot-scored targets, network capture and QA traces. Use for any interactive browser task; not for a plain search or an unblocked static fetch."
---

# Browser

One library, two engines. omowright ships inside this skill; choose the engine before you act:

| You need | Engine | Entry point |
|---|---|---|
| A site the user is signed into, their open tabs, an extension popup, a step only they can do | **attached** — the user's own browser through BrowserSkill | `connectBrowserSkill()` |
| QA of a local or public page, screenshots at device sizes, scraping, network capture, a QA trace, bot-scored targets, headless runs | **owned** — a browser your code launches on a throwaway profile | `connectPipe()` / `connectCloakProfile()` |
| The tab the user watches beside the chat in OmO Desktop (`OMO_BROWSER_ENGINE` is set) | the app's built-in browser | `connectBuiltinBrowser()` — [references/desktop.md](references/desktop.md) |
| A 403/WAF host neither engine opens, a platform with a native reader, an archive snapshot | neither | the `ultimate-browsing` skill |

**Anything that needs the user's logins is attached.** It works in an Agent Window inside the user's own
profile, never a copy, and exists only where the user enabled the BrowserSkill extension. Never
substitute one engine for the other silently, and **never launch a headless browser because the
attached one is missing**: it has none of the user's sessions. Run the doctor, relay its one step.

```js
const { loadOmowright } = await import("<skill-root>/scripts/omowright.mjs")
const { omowright } = await loadOmowright()
```

Before the first attached session: `node "<skill-root>/scripts/browser-doctor.mjs" --json`. `ready`
means start; every other state and its one next step are in [references/install.md](references/install.md).

## Three rules for both engines

**1. WAIT FOR A STATE, NEVER FOR A CLOCK.** No `Bun.sleep`, no `setTimeout` delay, no hand-written
poll loop: a fixed delay fails on a slow page and wastes itself on a fast one. Start the wait
before the action that causes it. `goto`, `newTab` and `navigate` already wait for content, so
nothing follows them.

| Waiting for | Owned | Attached |
|---|---|---|
| Page content appearing or changing | `page.waitForFunction(fn, undefined, { timeout })` (options are the THIRD argument), `page.locator(ref).waitFor()` | `navigate(url, { waitUntil: "networkidle" })`; later, `session.waitForElement(target, { state: "visible", timeoutMs })`, or for any other state `evaluate` a promise that resolves on it (`{ awaitPromise: true, timeoutMs, context }`) |
| The request an action triggers | `const got = page.waitForResponse("**/api/x")`, act, `await got` | `waitForNavigation()` after an action that navigates |
| A feed that loads more as you scroll | `omowright.collectWhileScrolling(page, snoop, { minItems, maxScrolls, extract })` over a `createNetworkSnoop`: [network.md](references/owned-engine/network.md) | `session.scrollTo(target)`, then wait as in the first row |
| A person | `requestHuman(page, { prompt, until })` | `session.requestHelp({ prompt, targets })` |

**2. ONE CONNECTION PER TASK, AND A LONG WAIT GOES TO `tool.monitor`.** Keep the handle on
`globalThis` and reuse it in later cells; a new connect in every cell throws the page state away.
A cell detaches after 30 s and then blocks the js kernel, so anything that may run longer (a
person, a deploy, a slow job) is **never awaited in a cell**. Subscribe first, start the wait
without `await`, and end the cell; the event wakes you on success and on timeout alike:

```js
// given: page
const flag = `${(await import("node:os")).tmpdir()}/signed-in-${Date.now()}.flag`
await tool.monitor({ description: "sign-in finished", path: flag, event: "create" })
globalThis.wait = page.waitForFunction(() => !!document.querySelector("[data-user]"), undefined, { timeout: 600_000 })
  .then(() => Bun.write(flag, "ok"), (e) => Bun.write(flag, `failed: ${e.message}`))
```

The same shape holds for `requestHelp`, `requestHuman` and any other promise. For a state outside
the page (a dev server, a build) watch a command instead:
`tool.monitor({ description, command: "until curl -sf localhost:3000 >/dev/null; do sleep 1; done; printf 'READY\\n'", filter: "^READY$" })`.

**3. READ WITHIN A TOKEN BUDGET.** Read the smallest thing that answers the question:
`session.observe({ maxTokens: 4000 })` attached, and `session.read(target)` for the text, value or attributes of a few nodes; `omowright.compactSnapshot(await page.snapshot({ find: "Checkout" }))`
owned (`{ interactive: true }` for controls only, `{ diff: true }` after an action).
`omowright.snapshotTokens(snapshot).estTokens` measures a tree before you print it. From
`evaluate`, return the fields you need; never print `getHtml()`, `innerHTML` or a page's `innerText`.

## The loop (owned)

```js
const { mkdtempSync, rmSync } = await import("node:fs"), { tmpdir } = await import("node:os"), { join } = await import("node:path")
const profile = mkdtempSync(join(tmpdir(), "omowright-"))
globalThis.browser = await omowright.connectPipe({
  browserPath: omowright.detectBrowsers().find((b) => b.installed)?.binary,   // bot-scored target: connectCloakProfile() instead
  browserArgs: ["--headless", "--no-first-run", `--user-data-dir=${profile}`], storageRoot: profile,
})
globalThis.page = await browser.newTab("http://localhost:3000/")
await omowright.emulate(page, "iphone-14")                    // iphone-14 | pixel-7 | ipad-air | desktop-1440
print(omowright.compactSnapshot(await page.snapshot({ interactive: true })))   // refs (e7) come from the latest snapshot
const saved = page.waitForResponse("**/api/cart")
await page.locator("e7").click(); await saved
display(await page.screenshot())
// the task's last cell, on success and failure: await browser.close(); rmSync(profile, { recursive: true, force: true })
```

Launch, network capture, frames, coordinates and CAPTCHA: [references/owned-engine/README.md](references/owned-engine/README.md).

## The loop (attached)

```js
globalThis.session = await omowright.connectBrowserSkill({ name: "<task>", focused: false })
const sync = async () => (await session.cooperate("sync")).context_id                      // strict policy: one context per gated action
await session.navigate("https://example.com/", { waitUntil: "load" })                      // the first navigate needs no context
const vom = await session.observe({ maxTokens: 4000 })                                     // @eN refs; shadow DOM and frames included
const { items } = await session.read("a")                                                  // [{ ref, values: { text } }]: no context, no script
await session.hover("a", { context: await sync(), expect: [{ target: "a", field: "text", equals: items[0].values.text }] })
await session.press("End", { context: await sync() })
await session.navigate("https://example.org/", { waitUntil: "load", context: await sync() })
const shot = await session.screenshot()                                                    // { buffer, width, height, captureId }
// the task's last cell, on success and failure: await session.stop()                      // returns borrowed tabs
```

1. **Refs are reissued by every read, `cooperate("sync")` included.** Act on a ref in the cycle you
   read it, or use a CSS selector, which resolves live; navigation and large DOM changes stale all refs.
2. **Two identical failures mean change approach, not retry.** A third identical attempt is a defect.
3. **Sync before every gated action except the first navigate.** Under the default `strict`
   policy a context from `session.cooperate("sync")` is good for one action; reads (`observe`,
   `read`, `snapshot`, `screenshot()`, `waitForElement`, `waitForNavigation`) need none. `expect`
   names facts the extension checks right before the input; a false one refuses the action and
   nothing reaches the page. Under strict that refusal carries `cooperation_sync_required` and
   a message starting `Precondition failed:`, so read the page again instead of waiting. The `target` policy reuses one context
   across DOM actions: [references/commands.md](references/commands.md). On
   `cooperation_sync_required` the person is using the tab:
   `session.cooperate("wait", { timeoutMs: 25_000 })` until `ready`, read again and replan; never
   replay the refused action.
4. **Borrow a user tab explicitly** (`tabList({ scope: "user" })`, `tabBorrow(id)`, `tabReturn(id)`).
   Borrowing prompts the user; never invent tab ids and never repeat a denied borrow.
5. **Always `stop()` the session**, and keep `focused: false`: the browser belongs to someone who is
   probably using it.

Every method, its options, the gated list and the failure codes: [references/commands.md](references/commands.md).

## When a human is the only way through

Login, CAPTCHA, OTP, a payment confirmation, a consent dialog:

```js
const flag = `${(await import("node:os")).tmpdir()}/help-${Date.now()}.flag`
await tool.monitor({ description: "help finished", path: flag, event: "create" })
globalThis.help = session.requestHelp({ prompt: "<what you need done>", targets: ["@e4"], timeoutMs: 300_000 })
  .then((r) => Bun.write(flag, r.outcome), (e) => Bun.write(flag, `failed: ${e.message}`))
```

A person takes longer than a cell, so this is rule 2. When the event arrives, read the flag and
the page again. Respect a `cancelled` or `timed_out` outcome; do not work around it by changing
the extension's automation settings.

## Rules

- **Never read credentials through the page.** No `evaluate` that extracts a password, token,
  cookie or recovery code. The value of the attached engine is that the browser is already signed in.
- **Never clear cookies, cache or site data.** It is the user's real profile; clearing it logs them
  out everywhere. No flow here needs it.
- **Bot-scored or WAF targets never go through the attached engine** — route them to the
  `ultimate-browsing` skill, whose browser tier is `connectCloakProfile()`. The attached engine's
  daemon enables console capture on every tab it drives, which is a known automation signal.

## Where the rest lives

| Topic | Read |
|---|---|
| Session methods, targets, options, error codes | [references/commands.md](references/commands.md) |
| Doctor states, installing the CLI, daemon and extension, the one human step | [references/install.md](references/install.md) |
| The built-in browser inside OmO Desktop | [references/desktop.md](references/desktop.md) |
| Agent on one machine, browser on another | [references/remote.md](references/remote.md) |
| Owned engine: launch, snapshot ladder, network, frames, human handoff | [references/owned-engine/README.md](references/owned-engine/README.md) |
| Reading a 1Password vault the user has unlocked | [references/recipes/1password.md](references/recipes/1password.md) |
