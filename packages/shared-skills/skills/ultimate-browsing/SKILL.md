---
name: ultimate-browsing
description: "Renders, drives, and screenshots web pages: JS-rendered sources, clicks and forms, persistent logins, WAF-blocked hosts (platform-native readers, stealth Chrome), and the browsing lane of a research run, with screenshots as provenance. Not for plain search or unblocked static fetch."
---

# Ultimate Browsing

Web access for everything a plain fetch cannot finish: a page that renders in JS, a click or a form, a screenshot, a login that must persist across pages, or a host that blocks generic fetchers (WAF / 403 / Cloudflare). Start at the cheapest tier that can do the job and climb only when it cannot:

**Tier 1 — insane-search** (headless extraction + WAF bypass) -> **Tier 1.5 — agent-reach** (platform-native APIs, esp. Chinese platforms) -> **Tier 2 — a real browser** through omowright from js eval: 2a the owned engine (a browser your code launches, CloakBrowser for stealth), 2b the attached engine (the user's own signed-in browser).

## PHASE 0 — ROUTE FIRST (MANDATORY)

```
User request
  |
  +- extract text/data from a URL --------------------- TIER 1  insane-search
  +- URL blocked / 403 / Cloudflare / WAF ------------- TIER 1  insane-search
  +- YouTube/Vimeo/TikTok subtitles or metadata ------- TIER 1  insane-search (yt-dlp)
  +- read an article / blog / Reddit / HN / arXiv ----- TIER 1  insane-search
  |
  +- Chinese platform (xhs/douyin/weibo/bilibili/v2ex/wechat)  TIER 1.5 agent-reach
  +- podcast transcript / stock forum ----------------- TIER 1.5 agent-reach
  +- Twitter feed / LinkedIn profile / GitHub via CLI - TIER 1.5 agent-reach
  |
  +- Tier 1/1.5 returned empty or partial ------------- TIER 2  2a owned engine -> 2b attached engine
  +- click / fill form / scroll / interact ------------ TIER 2  2a owned engine -> 2b attached engine
  +- screenshot / render / play video ----------------- TIER 2  2a owned engine -> 2b attached engine
  +- login session across pages / the user's account --- TIER 2  2b attached engine (their browser)
  +- test web app / QA / dogfood ---------------------- TIER 2  2a owned engine -> 2b attached engine
  |
  +- simple search query ------------------------------ NOT this skill (use web-search)
```

Read the matching reference before acting: [`references/insane-search/README.md`](references/insane-search/README.md), [`references/agent-reach/README.md`](references/agent-reach/README.md), or [`references/chrome-stealth.md`](references/chrome-stealth.md).

## Tier 1 — insane-search (headless extraction)

**When**: content extraction, blocked-URL bypass, media metadata — no browser UI needed.
**Why first**: ~10x faster than a browser, no process spin-up; handles most "fetch this blocked page" requests via curl_cffi TLS impersonation, yt-dlp (1858 sites), official public APIs, mobile URL transforms, **Phase-2.5 surrogate archives** (Wayback / archive.today snapshots, provenance-tagged — see [`references/insane-search/cache-archive.md`](references/insane-search/cache-archive.md)), a key-gated Jina Reader (`JINA_API_KEY`), and a Playwright real-Chrome fallback. The engine lives **inside this skill** at `engine/` and is invoked as a module. Surrogate results are dated COPIES: a result whose `provenance` is `snapshot` must be reported with its `snapshot_timestamp`, never presented as the live page.

```bash
# Core command — auto-detects WAF, runs the full fetch grid (run from the skill dir):
python3 -m engine "https://example.com/blocked-page"
#   add --selector "<CSS>" for positive-proof validation, --device auto|desktop|mobile,
#   --trace to inspect every attempt, --json for machine-readable output.

# YouTube subtitles / metadata (no browser):
yt-dlp --write-sub --write-auto-sub --sub-lang "en,ko" --skip-download -o "/tmp/%(id)s" "<URL>"

# Reddit / HN / Bluesky / arXiv etc. use official public endpoints — see the Phase 0 index in
# references/insane-search/README.md (Twitter syndication, Reddit .json, HN Firebase, ...).
```

The full engine harness (rules R1-R7, the Phase 0 official-API index, the no-site-name rule, and the `references/insane-search/*.md` deep-dives for TLS, Playwright routing, Naver, media, etc.) is in [`references/insane-search/README.md`](references/insane-search/README.md). Read it before tuning the engine or adding a WAF profile.

### Escalate to Tier 1.5 or Tier 2 when
- The target is a Chinese / social platform with a native reader -> Tier 1.5.
- insane-search returns empty/partial, or the page needs JS interaction, a screenshot, a persistent login, or media playback -> Tier 2.

## Tier 1.5 — agent-reach (platform-native readers)

**When**: the target is a platform with a first-class API/CLI that beats generic fetching — especially Chinese platforms that stealth browsers still cannot reach cleanly. Several channels are zero-config (Douyin, V2EX, Reddit, RSS, YouTube); others need a one-time auth you supply via environment variables if you have access (`JINA_API_KEY` for Jina Reader — anonymous access is dead, see `references/insane-search/jina.md`; `TWITTER_*` for X; a transcription key for podcasts).

| Category | Platforms | Entry |
|---|---|---|
| social | xhs (Xiaohongshu), douyin, weibo, bilibili, V2EX, Reddit, Twitter/X | [references/agent-reach/social.md](references/agent-reach/social.md) |
| web | Jina Reader, WeChat articles, RSS | [references/agent-reach/web.md](references/agent-reach/web.md) |
| video | YouTube, Bilibili, podcast transcripts, Douyin video | [references/agent-reach/video.md](references/agent-reach/video.md) |
| career | LinkedIn | [references/agent-reach/career.md](references/agent-reach/career.md) |
| dev | GitHub (gh CLI) | [references/agent-reach/dev.md](references/agent-reach/dev.md) |
| search | Exa AI | [references/agent-reach/search.md](references/agent-reach/search.md) |

```bash
mcporter call 'douyin.parse_douyin_video_info(url: "<URL>")'   # douyin, zero-config
curl -s "https://r.jina.ai/https://weibo.com/<uid>/<pid>"      # weibo via Jina
yt-dlp --dump-json "<bilibili-url>"                            # Bilibili (overseas: add --cookies-from-browser)
curl -s "https://www.v2ex.com/api/topics/hot.json"            # V2EX public API
```

Routing table, per-platform auth (set `TWITTER_*` env vars, `gh auth login`, a transcription key — only if you have access), rate-limit notes, and known version quirks are in [references/agent-reach/README.md](references/agent-reach/README.md).

## Tier 2 — a real browser (real interaction)

**When**: real interaction is needed (clicks, forms, screenshots, video, persistent login), or Tier 1/1.5 failed.

Both tiers are omowright, staged inside the `browser` skill and loaded from js eval:

```js
const { loadOmowright } = await import("<browser-skill-root>/scripts/omowright.mjs")
const { omowright } = await loadOmowright()
```

### Tier 2a — owned engine (default)

A browser your code launches with a task-owned profile. `connectPipe` opens no listening port; `connectCloakProfile` launches CloakBrowser with a pinned fingerprint seed and is the path for WAF, Cloudflare and bot-scored pages.

```js
const browser = await omowright.connectPipe({ browserPath, browserArgs: ["--headless", `--user-data-dir=${profile}`], storageRoot: profile })
try {
  const page = await browser.newTab(url)
  const tree = omowright.compactSnapshot(await page.snapshot())   // the read; refs come from it
  const snoop = omowright.createNetworkSnoop(page)                  // read the API JSON instead of the DOM when there is one
  await page.locator("e3").click()
  await Bun.write(pngPath, await page.screenshot())
} finally {
  await browser.close()                                            // then rm -rf the profile
}
```

The rest of the surface (CUA coordinates, captcha solving, routes, traces, frames, human handoff) is in the `browser` skill's `references/owned-engine/`. A stealth binary is not proof of access: inspect the rendered result and report challenges that remain.

### Tier 2b — attached engine (logged-in pages)

When the page needs the user's account, drive the browser they are already signed into instead of cloning their profile: `connectBrowserSkill()` → `session.navigate` → `bskSnapshot(session)` / `session.observe()` → `session.click` → `session.stop()`. NEVER launch against or clear cookies/cache/site data from the user's live profile, and never fall back to the owned engine for an authenticated criterion: if no extension is connected, run the `browser` skill's onboarding script and relay its one human step. The full loop is the `browser` skill.

### Cookie login (cross-platform)

`scripts/extract_cookies.py` reads cookies from a local Chromium-family or Firefox-family browser and optionally injects them into the running CDP session. It resolves browser profile paths and decrypts cookie values per-OS (macOS Keychain, Linux libsecret, Windows DPAPI):

```bash
# Extract cookies to a file:
mkdir -p ~/.local/state/omo-cookies
python3 scripts/extract_cookies.py --browser chrome --domain youtube.com --output ~/.local/state/omo-cookies/youtube.cookies.json
# Extract and inject into the running CDP session:
python3 scripts/extract_cookies.py --browser chrome --domain youtube.com --inject --cdp 9242
```

Cookie export files are written with owner-only `0600` permissions. Do not place live auth cookies in shared temp directories or commit them to a repo. Cookie injection sends values to CDP over stdin rather than argv. Cookies apply on next navigation — reload after injecting. Google services use fingerprint-bound tokens that may not transfer across browser profiles. Limits in [references/chrome-stealth.md](references/chrome-stealth.md).

## Reference docs

| File | When to read |
|------|-------------|
| [references/insane-search/README.md](references/insane-search/README.md) | Tier-1 engine harness (R1-R7, Phase 0 API index, no-site-name rule) + its `*.md` deep-dives |
| [references/agent-reach/README.md](references/agent-reach/README.md) | Tier-1.5 routing table, platform auth, per-category `*.md` |
| [references/chrome-stealth.md](references/chrome-stealth.md) | Tier-2 stealth through omowright + CloakBrowser, cookie login limits |

## Environment variables

```bash
# agent-reach auth: set the channel-specific env vars from each tool's docs only if you have access
# insane-search needs no env vars — it auto-installs deps on first run
```

## Anti-patterns

- Do NOT launch Chrome stealth for plain text extraction — use Tier 1.
- Use stealth plugins only in an explicitly installed script environment, not injected into WebView.
- Close every WebView/browser context when done and remove only task-owned profile clones.
- Do NOT inject cookies without reloading the page.
- Do NOT hardcode site domains/selectors into `engine/**` or `waf_profiles.yaml` — runtime hints only (see the no-site-name rule in the insane-search reference).
