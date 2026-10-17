import { test, expect } from "@playwright/test"

// Production builds leave OMO_WEB_DESKTOP_DOWNLOAD unset: until the desktop app launches, nothing
// on the site may lead to the download page. This spec runs against such a build
// (playwright.flag-off.config.ts); a gate removed from any entry point fails it.
test.describe("Download page while the launch flag is off", () => {
  test("/download is not served in any language", async ({ request }) => {
    // Locale redirects (a NEXT_LOCALE cookie from an earlier request) may come first; whatever
    // they lead to, the answer is a 404.
    for (const path of ["/download", "/ko/download", "/download?channel=beta"]) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(404)
      expect(new URL(response.url()).pathname, path).toMatch(/^\/(?:[a-z]{2}\/)?download$/)
    }
  })

  test("/desktop does not redirect to the download page", async ({ request }) => {
    const response = await request.get("/desktop", { maxRedirects: 0 })
    expect(response.status()).toBe(404)
  })

  test("the hero offers no desktop download", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByTestId("hero-desktop-cta")).toHaveCount(0)
    await expect(page.locator('a[href$="/download"]')).toHaveCount(0)
  })

  test("the sitemap leaves the download page out", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text()
    expect(sitemap).toContain("<loc>")
    expect(sitemap).not.toContain("/download")
  })
})
