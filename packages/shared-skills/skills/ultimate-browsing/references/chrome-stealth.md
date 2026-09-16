# Tier 2 — Chrome stealth through playwright-core scripts

For real-Chrome semantics, stealth, traces, or authenticated sessions, WRITE a
script and run it from the js-eval kernel. Use installed local Chrome, not a
managed browser download. Ordinary macOS captures on a Bun >= 1.4 kernel use
`new Bun.WebView()`; Linux/Windows WebView needs installed Chrome/Chromium/Edge.
Codex's ordinary browser surface is `browser:control-in-app-browser`.

## Install (one-time)

Only the user installs these script dependencies, once in the skill's engine
directory. Stealth plugins run inside scripts, never inside WebView:

```sh
cd "$SKILL_DIR/engine"
test -f package.json || cp templates/package.json package.json
bun add playwright-core@1.62.1 playwright-extra@4.3.6 puppeteer-extra-plugin-stealth@2.11.2
```

Chrome must already be installed. The bundled `templates/playwright_real_chrome.js`
and `templates/playwright_mobile_chrome.js` resolve these dependencies from their
parent engine directory. Without optional plugins, templates report the fallback
and use plain `playwright-core`; do not call that fallback stealth.

## Launch + drive

Close the source browser before cloning its user-data directory for a consistent
copy. Preserve its `Local State` alongside the selected profile. Use a private,
task-owned clone, never the live user-data-dir. NEVER clear the live profile's
cookies, cache, or site data. For unauthenticated QA, use a fresh task-owned profile.

Write `capture.cjs` in the engine directory. `clonePath`, URL, and output path are
arguments owned by this QA run; keep cookie values out of argv and logs:

```js
const { chromium: core } = require('playwright-core');
const { addExtra } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
const [clonePath, url, pngPath] = process.argv.slice(2);
const chromium = addExtra(core);
chromium.use(stealth());

async function capture() {
  const context = await chromium.launchPersistentContext(clonePath, {
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 720 },
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.screenshot({ path: pngPath });
    console.log(JSON.stringify({ pngPath, webdriver: await page.evaluate(() => navigator.webdriver) }));
  } finally {
    await context.close();
  }
}
capture().catch((error) => { console.error(error); process.exitCode = 1; });
```

Run the script from js eval with a bounded process lifetime:

```js
const { promisify } = await import('node:util')
const { execFile } = await import('node:child_process')
const result = await promisify(execFile)('node', [scriptPath, clonePath, url, pngPath], { timeout: 45000 })
console.log(result.stdout)
```

For extraction, run a bundled template the same way, supplying its JSON input on
stdin (`url`, `profileDir: clonePath`, `waitSelector`, `headless`). The template
returns HTML on stdout. For traces, use `context.tracing.start()` before navigation
and `context.tracing.stop({ path: tracePath })` before closing. Use `headless: false`
only with an available display when headed behavior is the criterion.

## Verify stealth

Inspect the page, screenshot, and requested content. `navigator.webdriver === false`
checks one browser property, NOT a promise to pass a detector or challenge.
Persistent challenge pages or missing content are failures, even if the script
exits zero. Do not keep retrying or silently swap browser tooling.

## Cookie login (cross-platform)

`scripts/extract_cookies.py` exports local-browser cookies with owner-only `0600`
permissions. Keep exports private and never commit them. For a persistent context,
load the exported cookies with `context.addCookies(...)`, then navigate/reload.
Browser- or device-bound login tokens may not transfer to a clone.

The helper's `--inject --cdp <port>` targets a task-owned local Chrome CDP endpoint,
which a script can also use via `chromium.connectOverCDP(...)`. Expose CDP on
loopback only, never against the live profile. Values travel on stdin, not argv.

## Anti-patterns

- Plain text extraction does not need a stealth browser: use the extraction lane.
- Never launch against, clear, or delete the user's live profile.
- Never claim stealth from successful startup alone; validate rendered content.
- Never run plugins without explicit user-installed script dependencies.

## Troubleshooting

A missing Chrome executable is a prerequisite failure: report it, do not download
a replacement. Missing plugins require the one-time setup above; module errors
inside installed plugins are real failures, not optional-dependency misses.
A locked profile usually means the source was not cloned or another run owns the
clone. Use a new task-owned clone instead of killing unrelated browsers.

Always close contexts in `finally`, stop the fixture server, and remove only this
run's clone and temporary scripts. Preserve requested PNG/trace evidence and record
the cleanup receipt, including failures.
