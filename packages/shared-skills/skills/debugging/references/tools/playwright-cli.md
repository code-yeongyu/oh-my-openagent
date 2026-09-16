# Browser QA — Scripts from js eval

A browser UI bug needs a rendered browser, not curl. Use two tiers from the
js-eval kernel: `new Bun.WebView()` on Bun >= 1.4 for ordinary captures (macOS
uses WebKit; Linux/Windows need installed Chrome/Chromium/Edge), otherwise a
written `playwright-core` script against local Chrome. Use the script tier for
Chrome semantics, stealth, traces, keyboard events, or authenticated profiles.
In Codex, prefer `browser:control-in-app-browser` for ordinary page control.

## When to reach for Playwright

Use the script tier for forms, hydration, responsive CSS, cookie/session flows,
service workers, or client-side navigation. For a backend-only status/body bug,
use HTTP. WebView is headless, WebKit has no CDP, and `type()` emits no keyboard
events; choose real Chrome when these distinctions affect the reproduction.

## Install (per-project)

Reuse installed `playwright-core`. If absent, the user can install the script
dependency once with `bun add playwright-core`. Chrome must already be installed;
report an absent executable rather than downloading a managed browser. Write the
script beside the dependency so normal module resolution works.

For stealth, use the ultimate-browsing reference `references/chrome-stealth.md`:
its optional plugins are user-installed once in the engine directory and executed
as a script, not injected into WebView.

## The four things you'll actually use

### 1. Write a reproduction script

Record the exact URL, inputs, viewport, expected UI state, and output artifact.
For auth, CLONE the user-data directory and use `launchPersistentContext` on the
clone. NEVER launch against or clear data from the live profile.

### 2. Reproduce + capture

```js
// debug-repro.mjs
import { chromium } from 'playwright-core';
const [url, pngPath, tracePath] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.tracing.start({ screenshots: true, snapshots: true });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => console.error(error));
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    // Add the scenario's actions and locator/state assertions here.
    await page.screenshot({ path: pngPath });
    console.log(pngPath);
  } finally {
    await context.tracing.stop({ path: tracePath });
    await context.close();
  }
} finally {
  await browser.close();
}
```

A screenshot alone is not a reproduction assertion. Use locators for the exact
observable state; fail the script when that state is absent.

### 3. Run from the js-eval kernel

```js
const { promisify } = await import('node:util')
const { execFile } = await import('node:child_process')
const result = await promisify(execFile)('node', [scriptPath, url, pngPath, tracePath], { timeout: 60000 })
console.log(result.stdout)
```

### 4. Inspect the trace

Retain the trace ZIP for the project's existing trace viewer and inspect the PNG.
Trace snapshots, network events, and screenshots identify where the UI diverged.
Keep auth-bearing traces private; do not upload them to public viewers.

## Headless vs headed during debugging

Use `headless: false` with an available display when reproducing headed-only
behavior. State which mode produced the evidence; do not claim a headless capture
proves desktop-browser permissions or window behavior.

## Catching the silent-failure patterns Playwright is good at

Subscribe before triggering the action: `page.on('pageerror', ...)`,
`page.on('requestfailed', ...)`, or a bounded `page.waitForResponse(...)` promise.
Await that specific response/state rather than sleeping or waiting for generic
network idleness. Propagate failed assertions and process exit codes.

## Viewport and device emulation

Use `page.setViewportSize({ width: 375, height: 667 })` for a narrow capture.
`devices` comes from `playwright-core`; apply the desired preset when creating
a context. Match the reference's pixel scale as well as its viewport.

## Gotchas

- Wait for state, not time: locator visibility or the exact response is the signal.
- Locators re-resolve after UI changes; stale element handles do not.
- Fresh task-owned contexts avoid cached state leaking between runs.
- Auth belongs in a private clone, never the live browser profile.
- Give every run its own output directory and bounded process lifetime.

## Phase 9 cleanup specifics

Close WebView/browser contexts even on failure, stop the fixture server, and remove
only this run's temporary scripts and profile clone. Preserve requested PNG/trace
artifacts, then record the cleanup receipt. Do not kill unrelated browsers or
remove a user's installed Chrome.
