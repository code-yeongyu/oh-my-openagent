import { test, expect } from "@playwright/test"

test.describe("Manifesto Page", () => {
  test("renders hero and core philosophy", async ({ page }) => {
    test.setTimeout(60000)
    // given
    await page.goto("/manifesto", { waitUntil: "domcontentloaded", timeout: 45000 })

    // when
    const heading = page.getByRole("heading", { name: "Ultrawork Manifesto" })
    const bottleneckText = page.getByText("HUMAN IN THE LOOP = BOTTLENECK").first()

    // then
    await expect(heading).toBeVisible()
    await expect(bottleneckText).toBeVisible()
  })

  test("renders CTA with GitHub link", async ({ page }) => {
    test.setTimeout(60000)
    // given
    await page.goto("/manifesto", { waitUntil: "domcontentloaded", timeout: 45000 })

    // when
    const ctaLink = page.getByRole("link", { name: /Get Oh My OpenAgent/i })

    // then
    await expect(ctaLink).toBeVisible()
    await expect(ctaLink).toHaveAttribute("href", "https://github.com/code-yeongyu/oh-my-openagent")
  })

  test("has no horizontal overflow at 375px", async ({ page }) => {
    // given
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/manifesto", { waitUntil: "domcontentloaded", timeout: 45000 })

    // when
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )

    // then
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
