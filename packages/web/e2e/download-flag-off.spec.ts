import { test, expect } from "@playwright/test"

// Production builds leave OMO_WEB_DESKTOP_DOWNLOAD unset: until the desktop app launches, nothing
// on the site may lead to the download page. This spec runs against such a build
// (playwright.flag-off.config.ts); a gate removed from any entry point fails it.
test.describe("Download page while the launch flag is off", () => {
  test("/download goes to the public beta download page in any language", async ({ request }) => {
    // Shipped desktop builds link /download; this site's own page stays off, so it must not 404.
    for (const path of ["/download", "/ko/download", "/download?channel=beta"]) {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status(), path).toBe(301)
      expect(response.headers()["location"], path).toBe("https://get.omo.dev/desktop/beta/")
    }
  })

  test("/desktop does not redirect to the download page", async ({ request }) => {
    const response = await request.get("/desktop", { maxRedirects: 0 })
    expect(response.status()).toBe(404)
  })

  test("the hero links the public desktop beta, not this site's own page", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("hero-desktop-cta")).toHaveCount(0)
    await expect(page.locator('a[href$="/download"]')).toHaveCount(0)
    await expect(page.getByTestId("hero-desktop-beta-cta")).toHaveAttribute(
      "href",
      "https://get.omo.dev/desktop/beta/",
    )
  })

  test("the sitemap leaves the download page out", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text()
    expect(sitemap).toContain("<loc>")
    expect(sitemap).not.toContain("/download")
  })
})
