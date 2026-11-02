# Browser setup (Web capture)

Capture with omowright from the js-eval kernel. The library is staged inside the `browser` skill;
load it once per session:

```js
const { loadOmowright } = await import("<browser-skill-root>/scripts/omowright.mjs")
const { omowright } = await loadOmowright()
```

## Owned engine (default for QA) - the capture matrix

A browser your code launches, with a task-owned profile, pinned viewport and no user state.
`connectPipe` opens no listening port and reaps the process on `close()`. One loop produces the
whole matrix the skill requires: phone (true mobile emulation) and desktop, light and dark, top
and scrolled-to-end, plus the reduced-motion variant for motion frames. `page.screenshot()` is a
PNG of the page itself, so no browser chrome can appear in it.

```js
// js-eval cell; urls and outDir belong to this QA run.
const { mkdtempSync, rmSync } = await import("node:fs")
const profile = mkdtempSync(`${(await import("node:os")).tmpdir()}/visual-qa-`)
const browser = await omowright.connectPipe({
  browserPath: chromeBinary,                      // installed Chrome, Chromium, CloakBrowser or chrome-headless-shell
  browserArgs: ["--headless", "--no-first-run", `--user-data-dir=${profile}`],
  storageRoot: profile,
})
const media = (page, sid, scheme, motion) => page.cdp.send("Emulation.setEmulatedMedia", {
  features: [{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: motion }],
}, sid)
let page
try {
  page = await browser.newTab("about:blank")
  const sid = await page.resolveSessionId()
  for (const [route, url] of Object.entries(urls)) {
    for (const device of ["iphone-14", "desktop-1440"]) {        // 390 @ DPR 3, mobile + touch (overlay scrollbars); 1440 @ DPR 1. Add { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, hasTouch: false } for page layouts.
      await omowright.emulate(page, device)
      for (const scheme of ["light", "dark"]) {
        await media(page, sid, scheme, "no-preference")
        await page.goto(url, { waitUntil: "load" })               // then wait for the page's own ready state (a locator, waitForURL, network snoop), never a sleep
        await Bun.write(`${outDir}/${route}-${device}-${scheme}-top.png`, await page.screenshot())
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await Bun.write(`${outDir}/${route}-${device}-${scheme}-end.png`, await page.screenshot())
      }
    }
  }
  // Motion frames: drive the state (hover/press/open), then capture rest, ~100 ms and settled; repeat under
  // media(page, sid, scheme, "reduce") for the reduced-motion pass.
} finally {
  if (page) await omowright.emulate(page, null)
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
  await session.resize(1440, 900)                                 // desktop column of the matrix
  await Bun.write(`${outDir}/${route}-1440-top.png`, (await session.screenshot()).buffer)   // { buffer, width, height }
  await session.emulate({ overrides: { width: 390, mobile: true } })  // phone column; `off: true` restores
  await Bun.write(`${outDir}/${route}-390-top.png`, (await session.screenshot()).buffer)
} finally {
  await session.emulate({ off: true })
  await session.stop()
}
```

The attached engine follows the signed-in browser's own colour scheme; switch the OS or browser
theme between the light and dark passes, and record which theme each file carries.

NEVER launch anything against, or clear cookies/cache/site data from, the user's live profile;
the attached engine is the only sanctioned way to a signed-in page. If no extension is connected,
run the `browser` skill's `scripts/browser-install.mjs` for the browser the user actually uses
(from memory, or its detection; on `needsChoice` ask them and pass `--browser=<id>`), relay its
one human step, and wait — do
not fall back to the owned engine for an authenticated criterion.

## Capture at a fixed viewport

Match CSS viewport AND PNG dimensions: pin `deviceScaleFactor` through `emulate` (owned) or
`resize` (attached) instead of resizing the PNG to force a pass; a 390-wide capture at desktop
DPR with classic scrollbars is not a phone capture. Wait for the specific page state (a locator,
a `waitForURL`, a `createNetworkSnoop(page).waitFor(...)`), not a sleep, then compare:

```sh
node "$SKILL_DIR/scripts/visual-qa.mjs" image-diff reference.png actual.png
```

Inspect `dimensionsMatch` and `diffRatio`, then inspect the image. Close every browser and session
and the fixture server, even on a failed capture; remove the owned profile in the same `finally`.
