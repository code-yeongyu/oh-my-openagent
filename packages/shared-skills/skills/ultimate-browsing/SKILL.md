---
name: ultimate-browsing
description: "Renders, drives, and screenshots web pages: JS-rendered sources, clicks and forms, persistent logins, WAF-blocked hosts (platform-native readers, stealth Chrome), and the browsing lane of a research run, with screenshots as provenance. Not for plain search or unblocked static fetch."
---

# Ultimate Browsing

Web access for everything a plain fetch cannot finish: a page that renders in JS, a click or a form, a screenshot, a login that must persist across pages, or a host that blocks generic fetchers (WAF / 403 / Cloudflare). Start at the cheapest tier that can do the job and climb only when it cannot:

**Tier 1 — insane-search** (headless extraction + WAF bypass) -> **Tier 1.5 — agent-reach** (platform-native APIs, esp. Chinese platforms) -> **Tier 2 — a real browser**: 2a Bun.WebView, 2b a local-Chrome `playwright-core` script from js eval for Chrome semantics, stealth, trace, or auth.

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
  +- Tier 1/1.5 returned empty or partial ------------- TIER 2  2a kernel browser -> 2b stealth
  +- click / fill form / scroll / interact ------------ TIER 2  2a kernel browser -> 2b stealth
  +- screenshot / render / play video ----------------- TIER 2  2a kernel browser -> 2b stealth
  +- login session across pages / inject cookies ------ TIER 2  2b Chrome stealth (profile + cookies)
  +- test web app / QA / dogfood ---------------------- TIER 2  2a kernel browser -> 2b stealth
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

### Tier 2a — kernel browser (default)

Use `new Bun.WebView()` from the js-eval kernel on Bun >= 1.4: macOS defaults to system WebKit; Linux/Windows need installed Chrome/Chromium/Edge. WebView is headless, WebKit has no CDP, and `type()` emits no keyboard events. For other kernels or when those differences matter, use 2b.

```js
const view = new Bun.WebView({ width: 1280, height: 800 })
try {
  await view.navigate(url)
  const title = await view.evaluate("document.title")
  await Bun.write(pngPath, await view.screenshot())
} finally {
  view[Symbol.dispose]()
}
```

Use 2b for real-Chrome semantics, stealth, trace, authenticated profiles, or a page the kernel browser cannot reach.

### Tier 2b — Chrome stealth (blocked or logged-in pages)

WRITE a `playwright-core` script and run it from js eval against installed local Chrome: `chromium.launch({ channel: "chrome" })`, or `launchPersistentContext` on a task-owned profile. For authenticated state, CLONE the user's profile first (`rsync -a <profile>/ <tmp-clone>/`); NEVER launch against or clear cookies/cache/site data from the live profile. Codex: prefer `browser:control-in-app-browser` for ordinary page control.

Keep the engine's Playwright templates for script-based extraction. Stealth is optional: the user installs `playwright-extra` + `puppeteer-extra-plugin-stealth` once in the engine directory and the script wraps the `playwright-core` browser type. Setup, persistent-context arguments, screenshots, and cleanup are in [references/chrome-stealth.md](references/chrome-stealth.md). A stealth flag is not proof of access: inspect the rendered result and report challenges that remain.

### Cookie login (cross-platform)

`scripts/extract_cookies.py` reads cookies from a local Chromium-family or Firefox-family browser and optionally injects them into the running CDP session. It resolves browser profile paths and decrypts cookie values per-OS (macOS Keychain, Linux libsecret, Windows DPAPI):

```bash
# Extract cookies to a file:
mkdir -p ~/.local/state/omo-cookies
python3 scripts/extract_cookies.py --browser chrome --domain youtube.com --output ~/.local/state/omo-cookies/youtube.cookies.json
# Extract and inject into the running CDP session:
python3 scripts/extract_cookies.py --browser chrome --domain youtube.com --inject --cdp 9242
```

Cookie export files are written with owner-only `0600` permissions. Do not place live auth cookies in shared temp directories or commit them to a repo. Cookie injection sends values to CDP over stdin rather than argv. Cookies apply on next navigation — reload after injecting. Google services use fingerprint-bound tokens that may not transfer across browser profiles. Full detail in [references/chrome-stealth.md](references/chrome-stealth.md).

## Reference docs

| File | When to read |
|------|-------------|
| [references/insane-search/README.md](references/insane-search/README.md) | Tier-1 engine harness (R1-R7, Phase 0 API index, no-site-name rule) + its `*.md` deep-dives |
| [references/agent-reach/README.md](references/agent-reach/README.md) | Tier-1.5 routing table, platform auth, per-category `*.md` |
| [references/chrome-stealth.md](references/chrome-stealth.md) | Tier-2 playwright-core scripts, optional stealth setup, cloned profiles, cookie login |

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
