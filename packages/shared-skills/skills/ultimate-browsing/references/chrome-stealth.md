# Tier 2 — stealth through omowright and CloakBrowser

For real-Chrome semantics, stealth, traces, or authenticated sessions, drive omowright from the
js-eval kernel. The library is staged inside the `browser` skill; load it with
`loadOmowright()` from that skill's `scripts/omowright.mjs`.

## Stealth is the engine, not a plugin

Bot-scored pages (Cloudflare Turnstile, FingerprintJS, DataDome) are handled by launching
**CloakBrowser** — a Chromium build with source-level fingerprint patches — through
`connectCloakProfile({ profileDir })`. The profile pins a fingerprint seed on first use and
refuses to change identity silently, so the same site sees the same browser on every run.

```js
const browser = await omowright.connectCloakProfile({ profileDir })
try {
  const page = await browser.newTab(url)
  console.log(await page.evaluate("navigator.webdriver"))     // must be false
  await Bun.write(pngPath, await page.screenshot())
} finally {
  await browser.close()
}
```

Do not pass an init-script for `navigator.webdriver` and do not add stealth plugins: CloakBrowser
patches the engine itself. A launch that still meets a challenge is handled by the `browser`
skill's ladder (`references/owned-engine/ladder.md`: layers, coordinates, `createCaptcha`), and a
page that only a signed-in user can reach belongs to the attached engine, not to a cloned profile.

## Cookie login limits

`scripts/extract_cookies.py` still exports cookies from a local browser; inject them with
`injectCookies(page, cookies)` into an **owned** profile. It sanitizes the set (drops expired
entries, keeps host-prefixed cookies secure and root-scoped). Limits that do not change:

- Accounts whose risk engines bind a session to a device (Google, password managers) invalidate a
  session reused from a new fingerprint; use the attached engine for those.
- Cookies apply on the next navigation — reload after injecting.
- NEVER copy a session out of, or clear cookies/cache/site data in, the user's live profile.

## The extraction engine's own Playwright fallback

The Tier-1 Python engine (`engine/`) keeps its own script-based Chrome fallback for headless
extraction; that is an engine internal, not an agent-facing browser path. Interactive work, QA and
screenshots go through omowright as above.
