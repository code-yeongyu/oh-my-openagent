#!/usr/bin/env node
/**
 * Generic Playwright fetcher — real Chrome channel (not bundled Chromium).
 *
 * Usage (driven by engine/executor.py):
 *   echo '{"url":"...", "profileDir":"/tmp/.p", "waitSelector":"article"}' | node playwright_real_chrome.js
 *
 * Outputs page HTML to stdout on success; errors to stderr with non-zero exit.
 *
 * NO-SITE-NAME RULE: this file must never branch on specific hostnames.
 * All site specifics come from the JSON input (url, waitSelector).
 *
 * Dependencies (install once on target machine):
 *   npm i -g playwright playwright-extra puppeteer-extra-plugin-stealth
 *   npx playwright install chrome    # system Chrome binary
 */

const fs = require('fs');

async function readStdinJson() {
  return await new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { reject(e); }
    });
    process.stdin.on('error', reject);
  });
}

function describeError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function warnBestEffort(action, error) {
  process.stderr.write(`best-effort ${action} failed: ${describeError(error)}\n`);
}

function isMissingTopLevelModule(error, moduleName) {
  return (
    error instanceof Error &&
    error.code === 'MODULE_NOT_FOUND' &&
    typeof error.message === 'string' &&
    error.message.includes(`Cannot find module '${moduleName}'`)
  );
}

function requireOptionalModule(moduleName) {
  let resolvedModule;
  try {
    resolvedModule = require.resolve(moduleName);
  } catch (e) {
    if (isMissingTopLevelModule(e, moduleName)) {
      warnBestEffort(`optional module ${moduleName}`, e);
      return null;
    }
    throw e;
  }
  return require(resolvedModule);
}

async function main() {
  const args = await readStdinJson();
  const url = args.url;
  if (!url) {
    process.stderr.write('missing url\n');
    process.exitCode = 2;
    return;
  }

  const profileDir = args.profileDir || '/tmp/.insane_pw_profile';
  const waitSelector = args.waitSelector || null;
  const timeoutMs = args.timeout || 60000;
  const headless = args.headless ?? false;     // Akamai/etc detect headless
  const viewport = args.viewport || { width: 1366, height: 900 };

  let chromium;
  const playwrightExtra = requireOptionalModule('playwright-extra');
  const stealthPlugin = playwrightExtra ? requireOptionalModule('puppeteer-extra-plugin-stealth') : null;
  if (playwrightExtra && stealthPlugin) {
    ({ chromium } = playwrightExtra);
    const stealth = stealthPlugin();
    chromium.use(stealth);
  } else {
    // Fallback to plain playwright (no stealth). Still uses channel:chrome.
    ({ chromium } = require('playwright'));
  }

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',          // real Chrome, not bundled Chromium
      headless,
      viewport,
    });
    const page = await ctx.newPage();
    const navTimeout = Math.min(timeoutMs, 90000);

    // Warmup hop: visit the site root first so Akamai-style bot managers
    // can run their JS sensor and set a resolved session cookie. Direct
    // landing on a search/deep URL is the classic first-hit rejection pattern.
    // Use domcontentloaded (not networkidle) — many SPAs keep analytics/xhr
    // open indefinitely and would hit the 90s timeout.
    try {
      const urlObj = new URL(url);
      const rootUrl = `${urlObj.protocol}//${urlObj.host}/`;
      if (rootUrl !== url) {
        await page.goto(rootUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout });
        await page.waitForTimeout(3500);   // let sensor JS finish
      }
    } catch (e) {
      warnBestEffort('warmup navigation', e);
      // warmup is best-effort; continue even if it hiccups
    }

    // Main page — DOM loaded then give the sensor a moment.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
    await page.waitForTimeout(2500);

    if (waitSelector) {
      try {
        await page.waitForSelector(waitSelector, { timeout: Math.min(timeoutMs, 20000) });
      } catch (e) {
        warnBestEffort('waitSelector', e);
        // Selector still missing — try one hard reload in case the first hit
        // landed on a challenge page and the sensor has just cleared.
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: navTimeout });
          await page.waitForTimeout(2000);
          try {
            await page.waitForSelector(waitSelector, { timeout: 10000 });
          } catch (e2) {
            warnBestEffort('retry waitSelector', e2);
            // Still no luck — caller validates HTML anyway.
          }
        } catch (e3) {
          warnBestEffort('selector recovery reload', e3);
          // reload failed — proceed with whatever we have
        }
      }
    } else {
      // Without a positive-proof selector, give the sensor a couple more seconds.
      await page.waitForTimeout(2000);
    }

    const html = await page.content();
    process.stdout.write(html);
    process.exitCode = 0;
    return;
  } catch (e) {
    process.stderr.write(`${describeError(e)}\n`);
    process.exitCode = 1;
    return;
  } finally {
    try {
      if (ctx) await ctx.close();
    } catch (e) {
      warnBestEffort('browser context close', e);
    }
  }
}

main();
