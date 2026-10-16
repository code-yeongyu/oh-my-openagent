# Browser QA — omowright from js eval

A browser UI bug needs a rendered browser, not curl. omowright is staged inside the `browser`
skill; load it from a js-eval cell and pick the engine the bug lives in:

```js
const { loadOmowright } = await import("<browser-skill-root>/scripts/omowright.mjs")
const { omowright } = await loadOmowright()
```

| The bug needs | Engine |
|---|---|
| A public page, a fresh profile, a pinned viewport, traces, network capture | **owned** — `connectPipe` (or `connectCloakProfile` when the site scores bots) |
| The user's login, their cookies, their open tabs | **attached** — `connectBrowserSkill()`; never a clone of their profile |

Chrome must already be installed for the owned engine; report an absent executable rather than
downloading a managed browser.

## The four things you'll actually use

### 1. Reproduce with a flight trace

```js
const profile = mkdtempSync(join(tmpdir(), "debug-repro-"))
const browser = await omowright.connectPipe({ browserPath, browserArgs: ["--headless", `--user-data-dir=${profile}`], storageRoot: profile })
const page = await browser.newTab("about:blank")
const trace = omowright.createTrace(page, { dir: traceDir })          // trace.jsonl + trace.har + before/after screenshots
const consoleErrors = []
page.on("console", (entry) => { if (entry.type === "error") consoleErrors.push(entry.text) })
try {
  await trace.step("open", () => page.goto(url, { waitUntil: "load" }))
  await trace.step("submit", async () => {
    const { tree } = await page.snapshot({ interactive: true })       // read, then act on a fresh ref
    await page.locator("e5").fill(value)
    await page.locator("e7").click()
    await page.waitForURL(/\/done/, { timeout: 10_000 })
  })
  await Bun.write(pngPath, await page.screenshot())
} finally {
  await trace.stop()
  await browser.close()
  rmSync(profile, { recursive: true, force: true })
}
```

A screenshot alone is not a reproduction assertion. Read the snapshot for the exact observable
state (a role, a name, a value) and fail the step when it is absent.

### 2. Read the network instead of guessing

```js
const snoop = omowright.createNetworkSnoop(page)
const hit = await snoop.waitFor({ url: /\/api\/submit/ }, { timeoutMs: 10_000 })   // subscribe BEFORE the click
console.log(hit.status, hit.body?.slice(0, 500))
```

Subscribe before triggering the action, then await that specific response; do not sleep or wait
for generic idleness. `createRoutes(page)` fails one request on purpose to test an error path.

### 3. Reproduce in the user's browser

When the bug only happens signed in:

```js
const session = await omowright.connectBrowserSkill({ name: "debug repro", focused: false })
try {
  await session.navigate(url)
  const { tree, css } = await omowright.bskSnapshot(session, { interactive: true })
  await session.click({ selector: css.e7 })
  const errors = await session.console({ since: 0 })
  const shot = await session.screenshot()
} finally {
  await session.stop()
}
```

The value of this engine is the state that curl and a fresh profile do not have — cookies,
localStorage, service workers. Never read credentials through `evaluate`, never clear the
profile's data.

### 4. Viewport and device emulation

`emulate(page, "iphone-14")` applies viewport, device scale factor, user agent and touch
together; `emulate(page, { width: 375, height: 667, deviceScaleFactor: 2, mobile: true, hasTouch: true })`
for a custom preset. Match the reference's pixel scale as well as its viewport.

## Headless vs headed during debugging

Drop `--headless` from `browserArgs` with an available display when reproducing headed-only
behavior. State which mode produced the evidence; do not claim a headless capture proves
desktop-browser permissions or window behavior.

## Gotchas

- Wait for state, not time: a snapshot ref, `waitForURL`, or a snooped response is the signal.
- Refs die on every new snapshot; read again after any navigation or large DOM change.
- Fresh task-owned profiles avoid cached state leaking between runs.
- Auth belongs to the attached engine, never to a copy of the live browser profile.
- Give every run its own output directory and a bounded process lifetime.

## Phase 9 cleanup specifics

`browser.close()` / `session.stop()` even on failure, stop the fixture server, and remove only this
run's profile directory. Preserve requested PNG/trace evidence; keep auth-bearing traces private.
