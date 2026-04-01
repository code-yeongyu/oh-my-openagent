const { chromium } = require('playwright');
const path = require('path');

(async () => {
  console.log('Starting Playwright...');
  const browser = await chromium.launch({ headless: true });
  
  // 1: Desktop home (1920x1080)
  console.log('Taking Desktop home...');
  let context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  let page = await context.newPage();
  await page.goto("https://stranmor.com", { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(__dirname, 'tmp/desktop-full.png'), fullPage: true });
  await context.close();
  console.log('Desktop home screenshot saved');

  // 2: Mobile home (390x844)
  console.log('Taking Mobile home...');
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  await page.goto("https://stranmor.com", { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(__dirname, 'tmp/mobile-full.png'), fullPage: true });
  await context.close();
  console.log('Mobile home screenshot saved');

  // 3: Desktop RU (1920x1080)
  console.log('Taking Desktop RU...');
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();
  await page.goto("https://stranmor.com/ru", { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(__dirname, 'tmp/desktop-ru-full.png'), fullPage: true });
  await context.close();
  console.log('Desktop RU screenshot saved');

  // 4: Desktop case study (1920x1080)
  console.log('Taking Desktop case study...');
  context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  page = await context.newPage();
  await page.goto("https://stranmor.com/case/ai-gateway", { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(__dirname, 'tmp/desktop-case-full.png'), fullPage: true });
  await context.close();
  console.log('Desktop case study screenshot saved');

  await browser.close();
})();
