import { test, expect } from "@playwright/test"

test.describe("Hero Stats", () => {
  test("renders the GitHub description as the hero tagline", async ({ page, request }) => {
    // given
    const stats: unknown = await (await request.get("/api/stats")).json()
    const description =
      typeof stats === "object" && stats !== null && "description" in stats
        ? stats.description
        : undefined
    expect(typeof description).toBe("string")

    // when
    await page.goto("/")

    // then
    const tagline = page.getByTestId("hero-tagline")
    await expect(tagline).toBeVisible()
    await expect(tagline).toHaveText(/\S/)
    await expect(tagline).toHaveText(String(description))
  })

  test("renders the agent count in the proof strip", async ({ page }) => {
    // given / when
    await page.goto("/")

    // then
    await expect(page.getByTestId("proof-strip").getByText(/^11 agents$/)).toBeVisible()
  })

  test("serves a generated Open Graph image", async ({ request }) => {
    // given / when
    const response = await request.get("/opengraph-image")

    // then
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("image/png")
    expect((await response.body()).length).toBeGreaterThan(10_000)
  })

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
