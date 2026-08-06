import { test, expect } from "@playwright/test"

test.describe("Hero Stats", () => {
  test("displays GitHub star count", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    const starStat = page.locator("text=/[\\d.]+k GitHub Stars/")

    // then
    await expect(starStat).toBeVisible()
  })

  test("keeps cached star count when live stats returns zero", async ({ page }) => {
    // given
    await page.route("**/api/stats", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          stars: "0",
          totalDownloads: "1M+",
          monthlyDownloads: "580k+",
          weeklyDownloads: "90k+",
        }),
      })
    })

    // when
    const statsResponse = page.waitForResponse((response) => response.url().includes("/api/stats"))
    await page.goto("/")
    await statsResponse

    // then
    await expect(page.getByText("0 GitHub Stars")).toBeHidden()
    await expect(page.locator("text=/[\\d.]+k GitHub Stars/")).toBeVisible()
  })

  test("displays total download count", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    const totalDownloads = page.locator("text=/[\\d.]+[kM]\\+? Total Downloads/")

    // then
    await expect(totalDownloads).toBeVisible()
  })

  test("displays monthly download count", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    const monthlyDownloads = page.locator("text=/[\\d.]+[kM]\\+? Monthly Downloads/")

    // then
    await expect(monthlyDownloads).toBeVisible()
  })
})
