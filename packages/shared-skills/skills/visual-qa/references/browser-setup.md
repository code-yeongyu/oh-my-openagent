# Browser setup (Web capture)

Capture with omowright from the js-eval kernel. The library is staged inside the `browser` skill;
load it once per session:

```js
const { loadOmowright } = await import("<browser-skill-root>/scripts/omowright.mjs")
const { omowright } = await loadOmowright()
```

## Owned engine (default for QA)

A browser your code launches, with a task-owned profile, pinned viewport and no user state.
`connectPipe` opens no listening port and reaps the process on `close()`.

```js
// js-eval cell; url and pngPath belong to this QA run.
const { mkdtempSync, rmSync } = await import("node:fs")
const profile = mkdtempSync(`${(await import("node:os")).tmpdir()}/visual-qa-`)
const browser = await omowright.connectPipe({
  browserPath: chromeBinary,                      // installed Chrome, Chromium, CloakBrowser or chrome-headless-shell
  browserArgs: ["--headless", "--no-first-run", `--user-data-dir=${profile}`],
  storageRoot: profile,
})
try {
  const page = await browser.newTab("about:blank")
  await omowright.emulate(page, { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, hasTouch: false })
  await page.goto(url, { waitUntil: "load" })
  await Bun.write(pngPath, await page.screenshot())
  console.log(pngPath)
} finally {
  await browser.close()
  rmSync(profile, { recursive: true, force: true })
}
```

Chrome must already be installed; report an absent executable rather than downloading a managed
browser. For bot-scored or WAF targets use `connectCloakProfile({ profileDir })` (CloakBrowser
with a pinned fingerprint seed) — the `browser` skill's `references/owned-engine/README.md`
covers it.

## Attached engine (authenticated pages)

When the capture needs the user's login, drive the browser they are signed into instead of
cloning its profile:

```js
const session = await omowright.connectBrowserSkill({ name: "visual-qa capture", focused: false })
try {
  await session.navigate(url, { waitUntil: "load" })
  await session.resize(1280, 720)
  const shot = await session.screenshot()            // { buffer, width, height }
  await Bun.write(pngPath, shot.buffer)
} finally {
  await session.stop()
}
```

NEVER launch anything against, or clear cookies/cache/site data from, the user's live profile;
the attached engine is the only sanctioned way to a signed-in page. If no extension is connected,
run the `browser` skill's `scripts/browser-install.mjs`, relay its one human step, and wait — do
not fall back to the owned engine for an authenticated criterion.

## Capture a screenshot at a fixed viewport

Match CSS viewport AND PNG dimensions: pin `deviceScaleFactor` through `emulate` (owned) or
`resize` (attached) instead of resizing the PNG to force a pass. Wait for the specific page state
(a locator, a `waitForURL`, a `createNetworkSnoop(page).waitFor(...)`), not a sleep, then compare:

```sh
node "$SKILL_DIR/scripts/visual-qa.mjs" image-diff reference.png actual.png
```

Inspect `dimensionsMatch` and `diffRatio`, then inspect the image. Close every browser and session
and the fixture server, even on a failed capture; remove the owned profile in the same `finally`.
