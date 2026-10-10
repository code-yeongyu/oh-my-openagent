import { expect, test } from "@playwright/test"

const LOCALES = ["en", "ko", "ja", "zh"] as const

test.describe("Work surface readability", () => {
  for (const locale of LOCALES) {
    test(`${locale} keeps the full ultrawork exchange inside the mobile viewport`, async ({
      page,
    }) => {
      // given
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.setViewportSize({ width: 375, height: 844 })
      const prefix = locale === "en" ? "" : `/${locale}`
      await page.goto(`${prefix}/`)
      await page.evaluate(() => document.fonts.ready)
      const exchange = page.locator('[data-section="ultrawork"]')

      // when
      await exchange.scrollIntoViewIfNeeded()

      // then
      const overflow = await exchange.evaluate((section) => ({
        section: section.scrollWidth - section.clientWidth,
        viewport: section.getBoundingClientRect().right - innerWidth,
      }))
      expect(
        overflow.section,
        "The exchange must not be clipped by the page shell",
      ).toBeLessThanOrEqual(1)
      expect(overflow.viewport).toBeLessThanOrEqual(1)

      const keyword = exchange.locator("mark")
      await expect(keyword).toBeVisible()
      const keywordBounds = await keyword.evaluate((mark) => {
        const rect = mark.getBoundingClientRect()
        return { left: rect.left, right: rect.right }
      })
      expect(keywordBounds.left).toBeGreaterThanOrEqual(0)
      expect(keywordBounds.right).toBeLessThanOrEqual(375)

      const clippedResponses = await exchange
        .locator("li")
        .evaluateAll((rows) => rows.filter((row) => row.scrollWidth > row.clientWidth + 1).length)
      expect(clippedResponses).toBe(0)
    })

    test(`${locale} wraps stationary model profiles inside the mobile viewport`, async ({
      page,
    }) => {
      // given
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.setViewportSize({ width: 375, height: 844 })
      const prefix = locale === "en" ? "" : `/${locale}`
      await page.goto(`${prefix}/`)
      await page.evaluate(() => document.fonts.ready)
      const profiles = page.getByTestId("model-marquee")

      // when
      await profiles.scrollIntoViewIfNeeded()

      // then
      const overflow = await profiles.evaluate((el) => el.scrollWidth - el.clientWidth)
      expect(
        overflow,
        "Stationary profiles must wrap rather than extend offscreen",
      ).toBeLessThanOrEqual(1)
      const labels = profiles.locator('.marquee-track:not([aria-hidden="true"]) li')
      expect(await labels.count()).toBeGreaterThan(0)
      const clippedLabels = await labels.evaluateAll(
        (rows) =>
          rows.filter((row) => {
            const rect = row.getBoundingClientRect()
            return rect.left < 0 || rect.right > innerWidth
          }).length,
      )
      expect(clippedLabels).toBe(0)
    })
  }
})
