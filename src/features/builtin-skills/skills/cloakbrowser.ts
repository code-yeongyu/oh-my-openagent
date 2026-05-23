import type { BuiltinSkill } from "../types"

export const cloakbrowserSkill: BuiltinSkill = {
  name: "cloakbrowser",
  description: "Use for browser-related tasks when anti-detection/stealth is needed. CloakBrowser is a drop-in Playwright replacement with source-level C++ fingerprint patches that passes bot detection (reCAPTCHA v3 score 0.9, Cloudflare Turnstile, FingerprintJS). Same API as Playwright — import { launch } from 'cloakbrowser' instead of import { chromium } from 'playwright'. Triggers: 'browser', 'stealth', 'anti-detection', 'cloakbrowser', 'headless browser', 'web scraping', 'bot detection'.",
  template: `# CloakBrowser — Stealth Chromium Automation

CloakBrowser is a drop-in Playwright replacement with 48 source-level C++ fingerprint patches.
Same API surface — everything you know about Playwright works identically.

## Install

\`\`\`bash
npm install cloakbrowser playwright-core
\`\`\`

On first launch, the stealth Chromium binary auto-downloads (~200MB, cached at ~/.cloakbrowser/).

## Usage

\`\`\`javascript
import { launch, launchContext, launchPersistentContext } from 'cloakbrowser';

// Basic — same as playwright's chromium.launch()
const browser = await launch();
const page = await browser.newPage();
await page.goto('https://example.com');
console.log(await page.title());
await browser.close();

// Convenience: browser + context in one call
const context = await launchContext({
  userAgent: 'Mozilla/5.0...',
  viewport: { width: 1920, height: 1080 },
});
const page = await context.newPage();
await page.goto('https://example.com');
await context.close(); // also closes browser

// Persistent profile — stay logged in, bypass incognito detection
const ctx = await launchPersistentContext({
  userDataDir: './chrome-profile',
  headless: false,
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto('https://example.com');
await ctx.close();
\`\`\`

## Options

\`\`\`javascript
// Headed mode (visible browser window)
const browser = await launch({ headless: false });

// With proxy
const browser = await launch({
  proxy: 'http://user:pass@proxy:8080',
});

// With timezone and locale
const browser = await launch({
  timezone: 'America/New_York',
  locale: 'en-US',
});

// Extra Chrome args (48 C++ patches already applied)
const browser = await launch({
  args: ['--fingerprint=12345'],
});

// Auto-detect timezone/locale from proxy IP (requires: npm install mmdb-lib)
const browser = await launch({
  proxy: 'http://proxy:8080',
  geoip: true,
});
\`\`\`

## Human-like behavior

\`\`\`javascript
import { launch } from 'cloakbrowser';

const browser = await launch({ humanize: true });
// Adds randomized typing delays, mouse movements, scroll behavior
\`\`\`

## CLI

Pre-download the binary or check installation:

\`\`\`bash
npx cloakbrowser install      # Download binary
npx cloakbrowser info         # Show version, path, platform
npx cloakbrowser update       # Check for newer binary
\`\`\`

## Key differences from vanilla Playwright

- \`navigator.webdriver\` is \`false\` (not detected as automation)
- WebGL vendor/renderer spoofed to look like real GPU hardware
- Canvas fingerprint randomized (non-deterministic rendering)
- CDP detection prevented (Playwright's protocol is invisible)
- TLS fingerprint identical to stock Chrome
- User-Agent auto-spoofed to Windows Chrome

## reCAPTCHA Tips

- Use \`page.type()\` instead of \`page.fill()\` for form filling
- Spend 15+ seconds on the page before triggering reCAPTCHA
- Avoid \`page.waitForTimeout()\` — use native \`setTimeout\` wrapped in Promise
- Space out \`grecaptcha.execute()\` calls (30+ seconds apart)

## Full Playwright API Available

All standard Playwright APIs work: \`page.click()\`, \`page.fill()\`, \`page.evaluate()\`,
\`page.screenshot()\`, \`page.waitForSelector()\`, \`page.keyboard\`, \`page.mouse\`, etc.
See https://playwright.dev for the complete API reference.`,
}
