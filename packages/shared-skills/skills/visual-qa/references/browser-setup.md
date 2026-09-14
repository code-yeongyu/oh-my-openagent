# Browser setup (Web capture)

Use the js-eval kernel for both tiers. In Codex, prefer
`browser:control-in-app-browser` for ordinary captures.

## Tier 1: Bun.WebView

On a Bun >= 1.4 kernel, `new Bun.WebView()` is the macOS default (system
WebKit, no browser download). Linux/Windows require `backend: "chrome"`
and installed Chrome/Chromium/Edge. WebView is headless; WebKit has no CDP,
and `type()` emits no keyboard events. Use tier 2 when these differences matter.

```js
// js-eval cell; url and pngPath belong to this QA run.
const view = new Bun.WebView({ width: 1280, height: 720 })
try {
  await view.navigate(url)
  await Bun.write(pngPath, await view.screenshot())
  console.log(pngPath)
} finally {
  view[Symbol.dispose]()
}
```

## Tier 2: playwright-core with local Chrome

For other kernels, real-Chrome semantics, stealth, traces, or authenticated
profiles, WRITE a script beside the project's installed `playwright-core`
dependency and execute it from js eval. The user installs `playwright-core`
once with `bun add playwright-core` if needed; Chrome must already exist.
No managed browser download is needed.

```js
// capture.mjs
import { chromium } from "playwright-core"
const [url, pngPath] = process.argv.slice(2)
const browser = await chromium.launch({ channel: "chrome", headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  await page.goto(url, { waitUntil: "load", timeout: 30000 })
  await page.screenshot({ path: pngPath })
  console.log(pngPath)
} finally {
  await browser.close()
}
```

Run from the js-eval kernel (also works on a Node kernel):

```js
const { promisify } = await import("node:util")
const { execFile } = await import("node:child_process")
const result = await promisify(execFile)("node", [scriptPath, url, pngPath], { timeout: 45000 })
console.log(result.stdout)
```

For auth, CLONE the user-data directory to a private task-owned directory
and use `chromium.launchPersistentContext(clonePath, { channel: "chrome" })`.
NEVER launch against or clear cookies/cache/site data from the live profile.
Close the context and remove only the clone after QA. For script-based stealth,
read the ultimate-browsing skill's `references/chrome-stealth.md`.

## Capture a screenshot at a fixed viewport

Match CSS viewport AND PNG dimensions: WebKit follows native display scale
(a 1280x720 viewport can yield 2560x1440 pixels). Use matching reference
captures or Chrome's `deviceScaleFactor`, not resizing to force a pass.
Wait for the specific page state, not a sleep, then compare:

```sh
node "$SKILL_DIR/scripts/visual-qa.mjs" image-diff reference.png actual.png
```

Inspect `dimensionsMatch` and `diffRatio`, then inspect the image. Close every
WebView/browser context and the fixture server, even on a failed capture.
