# The owned engine

A browser **your code launches and owns**, driven over CDP by omowright with its own profile. The
opposite of the attached engine: no user logins, full control.

```js
const { omowright } = await loadOmowright()
const profile = mkdtempSync(join(tmpdir(), "omowright-"))
const browser = await omowright.connectPipe({
  browserPath: "<CloakBrowser or chrome-headless-shell binary>",
  browserArgs: ["--headless", "--no-first-run", `--user-data-dir=${profile}`],
  storageRoot: profile,
  dialogPolicy: { accept: true },
})
try {
  const page = await browser.newTab("https://example.com/")
  const tree = omowright.compactSnapshot(await page.snapshot())   // ALWAYS compact before a model reads it
  await page.locator("e3").click()                                 // refs come straight from the snapshot
  await Bun.write("shot.png", await page.screenshot())
} finally {
  await browser.close()
  rmSync(profile, { recursive: true, force: true })                // paired: a leftover profile is a logged-in browser nobody watches
}
```

`connectPipe` launches over `--remote-debugging-pipe`: no listening port, stdio drained, the
process reaped on `close()`. `connect("http://127.0.0.1:<port>")` attaches to a browser something
else launched. `connectCloakProfile({ profileDir })` launches CloakBrowser with a pinned
fingerprint seed — the stealth path for WAF and bot-scored targets, where the attached engine's
console capture would be a signal.

## When it is the right engine

| Reason | Why the attached engine cannot |
|---|---|
| A throwaway or pinned synthetic profile | the attached engine is the user's real profile |
| Bot-scoring or fingerprint evasion | you do not get to configure the user's browser |
| Solving a challenge widget programmatically | needs coordinate control and OCR |
| Reading the network instead of the DOM | needs request interception on your own target |
| A QA flight trace (steps, HAR, screenshots) | recording someone's real session is not acceptable |
| Headless or unattended runs | the user's browser is on their desk |

For anything that needs the user's login, the attached engine wins. For extracting text from a
blocked URL, neither: use the `ultimate-browsing` skill.

## The page

`OmOPage` is Playwright-shaped: `goto`, `snapshot`, `locator(ref | css)`, `click`, `fill`,
`press`, `hover`, `check`, `selectOption`, `dragTo`, `setInputFiles`, `screenshot`, `pdf`,
`evaluate`, `waitForURL`, `keyboard`, `mouse`, `frameLocator`. A snapshot is an accessibility tree
with virtual refs (`[ref=e3]`, cross-origin frames as `f1e3`); `compactSnapshot()` drops the refs
map, about half the bytes. Readiness is a content probe (body plus interactive elements, landmarks
or text), not a timer; `goto(url, { waitUntil: "commit" })` is the escape hatch for empty pages.

## Reference

- [ladder.md](ladder.md) — the escalation ladder, viewport pinning, `createCua`, `createCaptcha`
- [network.md](network.md) — `createNetworkSnoop`, `collectWhileScrolling`, `createTrace`, `createRoutes`
- [frames-and-humans.md](frames-and-humans.md) — `snapshotWithFrames`, `describeLayers`, dialog policy, `emulate`, `requestHuman`

The library's own skill (`skills/omowright/SKILL.md` and `presets/*` in the omowright repository)
is the authoritative, longer treatment of each; these pages are the routing summary.
