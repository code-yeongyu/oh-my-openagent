#!/usr/bin/env node
/**
 * Generic Playwright mobile fetcher — real Chrome + device emulation.
 *
 * Usage:
 *   echo '{"url":"...", "device":"iPhone 13 Pro"}' | node playwright_mobile_chrome.js
 *
 * Device name must match playwright `devices[...]` keys (Pixel 7, iPhone 13 Pro,
 * iPad Pro 11, etc.). When in doubt, omit `device` — default is iPhone 13 Pro.
 *
 * NO-SITE-NAME RULE: same as playwright_real_chrome.js — no hostname branches.
 */

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

async function main() {
  const args = await readStdinJson();
  const url = args.url;
  if (!url) { process.stderr.write('missing url\n'); process.exit(2); }

  const profileDir = args.profileDir || '/tmp/.insane_pw_mobile_profile';
  const deviceName = args.device || 'iPhone 13 Pro';
  const waitSelector = args.waitSelector || null;
  const timeoutMs = args.timeout || 60000;
  const headless = args.headless ?? false;

  let chromium, devices;
  try {
    ({ chromium, devices } = require('playwright-extra'));
    const stealth = require('puppeteer-extra-plugin-stealth')();
    chromium.use(stealth);
  } catch (_e) {
    ({ chromium, devices } = require('playwright'));
  }

  const dev = devices[deviceName];
  if (!dev) {
    process.stderr.write(`unknown device: ${deviceName}\n`);
    process.exit(2);
  }

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless,
      ...dev,
    });
    const page = await ctx.newPage();
    const navTimeout = Math.min(timeoutMs, 90000);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });

    if (waitSelector) {
      try {
        await page.waitForSelector(waitSelector, { timeout: Math.min(timeoutMs, 20000) });
      } catch (_e) {}
    }

    const html = await page.content();
    process.stdout.write(html);
    process.exit(0);
  } catch (e) {
    process.stderr.write(`${e.name || 'Error'}: ${e.message || e}\n`);
    process.exit(1);
  } finally {
    try { if (ctx) await ctx.close(); } catch (_e) {}
  }
}

main();
