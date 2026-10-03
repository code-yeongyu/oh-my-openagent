import { test, expect, type Page } from "@playwright/test"

import { FIXTURE_PORT } from "./support/download-fixture-port"

const FIXTURE = `http://127.0.0.1:${FIXTURE_PORT}`

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

interface Browser {
  /** What `navigator.userAgentData.platform` says; `null` means the browser has no such API (Safari, Firefox). */
  readonly platform: string | null
  /** `architecture` from userAgentData's high-entropy values: "arm" or "x86". */
  readonly architecture?: string
  readonly mobile?: boolean
}

/** Chromium reports the host OS through userAgentData whatever the UA says; pin it per test. */
async function pretendBrowser(page: Page, browser: Browser): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      configurable: true,
      get: () =>
        value.platform === null
          ? undefined
          : {
              platform: value.platform,
              mobile: value.mobile === true,
              getHighEntropyValues: async () => ({
                architecture: value.architecture ?? "",
                bitness: "64",
              }),
            },
    })
  }, browser)
}

async function useScenario(name: string): Promise<void> {
  const response = await fetch(`${FIXTURE}/__scenario/${name}`, { method: "PUT" })
  expect(response.ok).toBe(true)
}

// The tests share one fixture host whose contents they switch, so they run one after another.
test.describe.configure({ mode: "serial" })

test.describe("Download page", () => {
  test.beforeEach(async () => {
    await useScenario("launched")
  })

  test("an Apple silicon Mac is offered the arm64 disk image first", async ({ page }) => {
    // given
    await pretendBrowser(page, { platform: "macOS", architecture: "arm" })

    // when
    await page.goto("/download")

    // then
    const primary = page.getByTestId("download-primary")
    await expect(primary).toHaveText(/Download for macOS/)
    await expect(primary).toHaveAttribute(
      "href",
      "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-arm64.dmg",
    )
    await expect(page.getByTestId("download-primary-meta")).toContainText("0.1.0")
    await expect(page.getByTestId("download-primary-meta")).toContainText("Apple silicon")
  })

  test("an Intel Mac is offered the x64 disk image", async ({ page }) => {
    // given
    await pretendBrowser(page, { platform: "macOS", architecture: "x86" })

    // when
    await page.goto("/download")

    // then
    await expect(page.getByTestId("download-primary")).toHaveAttribute(
      "href",
      "https://get.omo.dev/stable/0.1.0/OmO-0.1.0-x64.dmg",
    )
    await expect(page.getByTestId("download-primary-meta")).toContainText("Intel")
  })

  test("a Mac whose browser hides its CPU gets Apple silicon first and a one-click Intel alternative", async ({
    page,
  }) => {
    // given
    await pretendBrowser(page, { platform: null })
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", {
        configurable: true,
        get: () => "MacIntel",
      })
    })

    // when
    await page.goto("/download")

    // then
    await expect(page.getByTestId("download-primary")).toHaveAttribute("href", /arm64\.dmg$/)
    const intel = page.getByRole("link", { name: /Intel Mac/ })
    await expect(intel).toHaveAttribute("href", /x64\.dmg$/)
  })

  test("a Windows PC is offered the exe", async ({ page }) => {
    // given
    await pretendBrowser(page, { platform: "Windows", architecture: "x86" })

    // when
    await page.goto("/download")

    // then
    await expect(page.getByTestId("download-primary")).toHaveText(/Download for Windows/)
    await expect(page.getByTestId("download-primary")).toHaveAttribute("href", /x64\.exe$/)
  })

  test("a Linux PC is offered the deb and still sees the AppImage", async ({ page }) => {
    // given
    await pretendBrowser(page, { platform: "Linux", architecture: "x86" })

    // when
    await page.goto("/download")

    // then
    await expect(page.getByTestId("download-primary")).toHaveAttribute("href", /amd64\.deb$/)
    await expect(page.getByTestId("installer-row").filter({ hasText: "AppImage" })).toBeVisible()
  })

  test("every installer is listed with its size and a full SHA-256 to check against", async ({
    page,
  }) => {
    // given
    await pretendBrowser(page, { platform: "Windows" })

    // when
    await page.goto("/download")

    // then
    const rows = page.getByTestId("installer-row")
    await expect(rows).toHaveCount(5)
    await expect(rows.first()).toContainText(/\d+(\.\d+)? MB/)
    await expect(page.getByTestId("installer-row").filter({ hasText: "x64.exe" })).toContainText(
      "3".repeat(64),
    )
    await expect(page.getByRole("heading", { name: "Verify your download" })).toBeVisible()
    await expect(
      page.locator("pre code", { hasText: "Get-FileHash OmO-0.1.0-x64.exe" }),
    ).toBeVisible()
    await expect(
      page.locator("pre code", { hasText: "shasum -a 256 OmO-0.1.0-arm64.dmg" }),
    ).toBeVisible()
    await expect(
      page.locator("pre code", { hasText: "sha256sum OmO-0.1.0-amd64.deb" }),
    ).toBeVisible()
  })

  test("the release notes link stays on the download host and no link goes to GitHub", async ({
    page,
  }) => {
    // given
    await pretendBrowser(page, { platform: "macOS", architecture: "arm" })

    // when
    await page.goto("/download")
    await expect(page.getByTestId("download-primary")).toBeVisible()

    // then
    await expect(page.getByRole("link", { name: "Release notes" })).toHaveAttribute(
      "href",
      "https://get.omo.dev/stable/0.1.0/RELEASE-NOTES.md",
    )
    const hrefs = await page
      .locator("main a[href]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""))
    expect(hrefs.filter((href) => /github\.com/.test(href))).toEqual([])
  })

  test("the Beta switch swaps in the beta channel's installers", async ({ page }) => {
    // given
    await pretendBrowser(page, { platform: "macOS", architecture: "arm" })
    await page.goto("/download")
    await expect(page.getByTestId("download-primary")).toHaveAttribute("href", /\/stable\//)

    // when
    await page.getByRole("button", { name: "Beta" }).click()

    // then
    await expect(page.getByTestId("download-primary")).toHaveAttribute(
      "href",
      "https://get.omo.dev/beta/0.2.0-beta.3/OmO-0.2.0-beta.3-arm64.dmg",
    )
    await expect(page.getByTestId("download-primary-meta")).toContainText("0.2.0-beta.3")
  })

  test("a Linux visitor sees what exists instead of a wrong button when there is no Linux build", async ({
    page,
  }) => {
    // given
    await useScenario("no-linux")
    await pretendBrowser(page, { platform: "Linux", architecture: "x86" })

    // when
    await page.goto("/download")

    // then
    await expect(page.getByTestId("download-primary")).toHaveCount(0)
    await expect(page.getByText("No installer for your system yet")).toBeVisible()
    await expect(page.getByTestId("installer-row")).toHaveCount(3)
  })

  test("before launch the page says when the app arrives and offers no installer", async ({
    page,
  }) => {
    // given
    await useScenario("before-launch")
    await pretendBrowser(page, { platform: "macOS", architecture: "arm" })

    // when
    await page.goto("/download")

    // then
    await expect(page.getByRole("heading", { name: /Coming November 10/ })).toBeVisible()
    await expect(page.getByTestId("download-primary")).toHaveCount(0)
    await expect(page.getByTestId("installer-row")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Beta" })).toHaveCount(0)
  })

  test("before launch a visitor who asks for the beta by link still gets it", async ({ page }) => {
    // given
    await useScenario("before-launch")
    await pretendBrowser(page, { platform: "macOS", architecture: "arm" })

    // when
    await page.goto("/download?channel=beta")

    // then
    await expect(page.getByTestId("download-primary")).toHaveAttribute("href", /\/beta\//)
  })

  test("when the download host is down the page says so and points to the command-line install", async ({
    page,
  }) => {
    // given
    await useScenario("host-down")
    await pretendBrowser(page, { platform: "Windows" })

    // when
    await page.goto("/download")

    // then
    await expect(page.getByText("Downloads are unavailable right now")).toBeVisible()
    await expect(page.getByTestId("download-primary")).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Install from the command line" })).toHaveAttribute(
      "href",
      /\/docs\/install$/,
    )
  })

  test("a phone visitor is told to open the page on a computer", async ({ browser }) => {
    // given
    const context = await browser.newContext({
      userAgent: IPHONE_UA,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    })
    const page = await context.newPage()

    // when
    await page.goto("/download")

    // then
    await expect(
      page.getByText(/Open this page on your Mac, Windows or Linux computer/),
    ).toBeVisible()
    await expect(page.getByTestId("download-primary")).toHaveCount(0)
    await context.close()
  })

  test("the page fits a 390px screen without sideways scrolling", async ({ page }) => {
    // given
    await page.setViewportSize({ width: 390, height: 844 })
    await pretendBrowser(page, { platform: "Windows" })

    // when
    await page.goto("/download")
    await expect(page.getByTestId("download-primary")).toBeVisible()

    // then
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test("the Korean page is served at /ko/download", async ({ page }) => {
    // given
    await pretendBrowser(page, { platform: "macOS", architecture: "arm" })

    // when
    await page.goto("/ko/download")

    // then
    await expect(page.getByTestId("download-primary")).toHaveAttribute("href", /arm64\.dmg$/)
    await expect(page.getByTestId("download-primary")).toHaveText(/macOS/)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("OmO 다운로드")
  })
})

test.describe("Getting to the download page", () => {
  test("/desktop redirects to /download and keeps the visitor's language", async ({ request }) => {
    // when
    const english = await request.get("/desktop", { maxRedirects: 0 })
    const korean = await request.get("/ko/desktop", { maxRedirects: 0 })

    // then
    expect([307, 308]).toContain(english.status())
    expect(new URL(english.headers().location ?? "", "http://x").pathname).toBe("/download")
    expect([307, 308]).toContain(korean.status())
    expect(new URL(korean.headers().location ?? "", "http://x").pathname).toBe("/ko/download")
  })

  test("the hero's desktop call to action leads to the download page", async ({ page }) => {
    // given
    await useScenario("launched")
    await page.goto("/")

    // when
    await page.getByTestId("hero-desktop-cta").click()

    // then
    await expect(page).toHaveURL(/\/download$/)
    await expect(page.getByRole("heading", { level: 1, name: /Download OmO/ })).toBeVisible()
  })
})
