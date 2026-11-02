import { test, expect } from "@playwright/test"

test.describe("Manifesto Page", () => {
  test("renders the title, byline and closing", async ({ page }) => {
    test.setTimeout(60000)
    // given
    await page.goto("/manifesto", { waitUntil: "domcontentloaded", timeout: 45000 })

    // when
    const heading = page.getByRole("heading", { name: "Ultrawork Manifesto" })
    const byline = page.getByTestId("manifesto-byline")
    const closing = page.getByRole("heading", { name: "just ulw ulw" })

    // then
    await expect(heading).toBeVisible()
    await expect(byline).toContainText("Q Kim")
    await expect(closing).toBeVisible()
  })

  test("renders CTA with GitHub link", async ({ page }) => {
    test.setTimeout(60000)
    // given
    await page.goto("/manifesto", { waitUntil: "domcontentloaded", timeout: 45000 })

    // when
    const ctaLink = page.getByRole("link", { name: /Get OmO/i })

    // then
    await expect(ctaLink).toBeVisible()
    await expect(ctaLink).toHaveAttribute("href", "https://github.com/code-yeongyu/oh-my-openagent")
  })

  test("links the footnote to the archived January 2026 version", async ({ page }) => {
    test.setTimeout(60000)
    // given
    await page.goto("/manifesto", { waitUntil: "domcontentloaded", timeout: 45000 })
    const note = page.getByTestId("manifesto-legacy-note")
    await expect(note).toContainText("January 19, 2026")

    // when
    await Promise.all([
      page.waitForURL("**/manifesto/2026-01", { timeout: 15000 }),
      note.getByRole("link").click(),
    ])

    // then
    await expect(page.getByText(/Old version/)).toBeVisible()
    await expect(page.getByText("HUMAN IN THE LOOP = BOTTLENECK").first()).toBeVisible()
  })

  for (const route of ["/manifesto", "/manifesto/2026-01"]) {
    test(`${route} has no horizontal overflow at 375px`, async ({ page }) => {
      // given
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(route, { waitUntil: "domcontentloaded", timeout: 45000 })

      // when
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )

      // then
      expect(overflow).toBeLessThanOrEqual(1)
    })
  }
})
