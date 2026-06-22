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

  const profileDir = args.profileDir || '/tmp/.insane_pw_mobile_profile';
  const deviceName = args.device || 'iPhone 13 Pro';
  const waitSelector = args.waitSelector || null;
  const timeoutMs = args.timeout || 60000;
  const headless = args.headless ?? false;

  let chromium, devices;
  const playwrightExtra = requireOptionalModule('playwright-extra');
  const stealthPlugin = playwrightExtra ? requireOptionalModule('puppeteer-extra-plugin-stealth') : null;
  if (playwrightExtra && stealthPlugin) {
    ({ chromium, devices } = playwrightExtra);
    const stealth = stealthPlugin();
    chromium.use(stealth);
  } else {
    ({ chromium, devices } = require('playwright'));
  }

  const dev = devices[deviceName];
  if (!dev) {
    process.stderr.write(`unknown device: ${deviceName}\n`);
    process.exitCode = 2;
    return;
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
      } catch (e) {
        warnBestEffort('waitSelector', e);
      }
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
