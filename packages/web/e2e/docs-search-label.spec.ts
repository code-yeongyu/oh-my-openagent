import { expect, test } from "@playwright/test"

test.describe("Docs search control", () => {
  test("is named by its own label, not by its placeholder", async ({ page }) => {
    // given
    await page.goto("/docs")
    const search = page.getByPlaceholder("Search docs...")

    // when
    const name = await page
      .getByRole("searchbox", { name: "Filter documentation sections" })
      .count()

    // then
    expect(name).toBe(1)
    await expect(search).toHaveAccessibleName("Filter documentation sections")
    await expect(page.getByRole("navigation", { name: "Documentation sections" })).toBeVisible()
    await expect(page.getByRole("navigation", { name: "Search docs..." })).toHaveCount(0)
  })

  test("draws its boundary at 3:1 or better against its own fill", async ({ page }) => {
    // given
    await page.goto("/docs")

    // when
    const ratio = await page.getByRole("searchbox").evaluate((input) => {
      const channels = (color: string): number[] => (color.match(/[\d.]+/g) ?? []).map(Number)
      const linear = (value: number): number => {
        const srgb = value / 255
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
      }
      const luminance = ([r = 0, g = 0, b = 0]: number[]): number =>
        0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
      const style = getComputedStyle(input)
      const fill = channels(style.backgroundColor)
      const [r = 0, g = 0, b = 0, alpha = 1] = channels(style.borderTopColor)
      const border = [r, g, b].map(
        (value, index) => value * alpha + (fill[index] ?? 0) * (1 - alpha),
      )
      const [high, low] = [luminance(border), luminance(fill)].sort((x, y) => y - x)
      return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
    })

    // then
    expect(ratio).toBeGreaterThanOrEqual(3)
  })
})
