import { test, expect, type Page } from "@playwright/test"

/**
 * Playwright's `toBeVisible` treats `opacity: 0` as visible, so these checks read the computed
 * opacity of the hero content itself and of every ancestor up to the section (#8911: Firefox has
 * no `animation-timeline: view()` and the hero stayed at `opacity: 0`).
 */
async function effectiveOpacity(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((element) => {
    let opacity = 1
    for (let node: Element | null = element; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity)
    }
    return opacity
  })
}

const HERO_CONTENT = [
  "#hero-title",
  '[data-testid="hero-tagline"]',
  '[data-section="hero"] [data-install-tabs]',
  '[data-section="hero"] a[href$="/docs/install"]',
  '[data-testid="hero-dag"]',
] as const

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`hero content is opaque on load (reduced motion: ${reducedMotion})`, async ({ page }) => {
    // given
    await page.emulateMedia({ reducedMotion })
    await page.goto("/")

    // then
    for (const selector of HERO_CONTENT) {
      await expect.poll(() => effectiveOpacity(page, selector), { message: selector }).toBe(1)
    }
  })
}

test("hero content is opaque without JavaScript", async ({ browser }) => {
  // given
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto("/")

  // then
  expect(await effectiveOpacity(page, "#hero-title")).toBe(1)
  expect(await effectiveOpacity(page, '[data-testid="hero-tagline"]')).toBe(1)
  await context.close()
})
