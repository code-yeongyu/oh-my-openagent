import { test, expect, type Page } from "@playwright/test"

const UNIX_COMMAND = "curl -fsSL https://get.omo.dev/install.sh | bash"
const POWERSHELL_COMMAND = "irm https://get.omo.dev/install.ps1 | iex"
const CMD_COMMAND =
  'powershell -ExecutionPolicy Bypass -c "irm https://get.omo.dev/install.ps1 | iex"'
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

/** Chromium reports the host OS through userAgentData whatever the UA says; pin it per test. */
async function pretendPlatform(page: Page, platform: string | null): Promise<void> {
  await page.addInitScript((value) => {
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      configurable: true,
      get: () => (value === null ? undefined : { platform: value, mobile: false }),
    })
  }, platform)
}

const SECTIONS = [
  "hero",
  "ultrawork",
  "mass-ulw",
  "models",
  "kibitzer",
  "skills",
  "crafted",
  "everywhere",
  "voices",
  "makers",
  "install",
] as const

test.describe("Home page", () => {
  test("renders the hero headline and its calls to action", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    const heading = page.getByRole("heading", { name: /Your tool for real work\./, level: 1 })
    const getStarted = page
      .locator('[data-section="hero"]')
      .getByRole("link", { name: "Get started" })

    // then
    await expect(page).toHaveTitle(/OmO/)
    await expect(heading).toContainText("But it's an agent.")
    await expect(getStarted).toHaveAttribute("href", /\/docs\/install$/)
  })

  test("shows the macOS/Linux install command first on a Mac", async ({ page }) => {
    // given
    await pretendPlatform(page, "macOS")
    await page.goto("/")
    const install = page.locator("#install")

    // then
    await expect(install.getByRole("tab")).toHaveCount(3)
    await expect(install.getByRole("tab", { name: "macOS, Linux, WSL" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(install.getByText(UNIX_COMMAND, { exact: true })).toBeVisible()
    await expect(install.getByText(POWERSHELL_COMMAND, { exact: true })).toBeHidden()
    await expect(install.getByText("Then open a new terminal and run omo.")).toBeVisible()
  })

  test("shows PowerShell first on Windows and moves between tabs with the arrow keys", async ({
    page,
  }) => {
    // given
    await pretendPlatform(page, "Windows")
    await page.goto("/")
    const install = page.locator("#install")
    const powershell = install.getByRole("tab", { name: "Windows PowerShell" })
    await expect(powershell).toHaveAttribute("aria-selected", "true")
    await expect(install.getByText(POWERSHELL_COMMAND, { exact: true })).toBeVisible()

    // when
    await powershell.focus()
    await page.keyboard.press("ArrowRight")

    // then
    const cmd = install.getByRole("tab", { name: "Windows CMD" })
    await expect(cmd).toBeFocused()
    await expect(cmd).toHaveAttribute("aria-selected", "true")
    await expect(powershell).toHaveAttribute("tabindex", "-1")
    await expect(install.getByText(CMD_COMMAND, { exact: true })).toBeVisible()
    await expect(install.getByText(POWERSHELL_COMMAND, { exact: true })).toBeHidden()

    // when
    await page.keyboard.press("Home")

    // then
    await expect(install.getByRole("tab", { name: "macOS, Linux, WSL" })).toBeFocused()
    await expect(install.getByText(UNIX_COMMAND, { exact: true })).toBeVisible()
  })

  test("tells a phone visitor to run the command on a computer", async ({ browser }) => {
    // given
    const context = await browser.newContext({
      userAgent: IPHONE_UA,
      viewport: { width: 375, height: 812 },
    })
    const page = await context.newPage()
    await pretendPlatform(page, null)
    await page.goto("/")
    const install = page.locator("#install")

    // then
    await expect(install.getByText(UNIX_COMMAND, { exact: true })).toBeVisible()
    await expect(
      install.getByText("Run this on your Mac, Linux or Windows computer."),
    ).toBeVisible()
    await expect(install.getByText("Then open a new terminal and run omo.")).toBeHidden()
    await context.close()
  })

  test("keeps every install command reachable without JavaScript", async ({ browser }) => {
    // given
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto("/")
    const install = page.locator("#install")

    // then
    for (const command of [UNIX_COMMAND, POWERSHELL_COMMAND, CMD_COMMAND]) {
      await expect(install.getByText(command, { exact: true })).toBeVisible()
    }
    await expect(install.getByRole("tablist")).toBeHidden()
    await context.close()
  })

  test("confirms a copied install command with a status message", async ({ page, context }) => {
    // given
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await pretendPlatform(page, "macOS")
    await page.goto("/")
    const install = page.locator("#install")

    // when
    await install.getByRole("button", { name: "Copy install command" }).click()

    // then
    await expect(install.getByRole("status")).toHaveText("Install command copied")
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(UNIX_COMMAND)
  })

  test("carries no legacy brand, edition or host names", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    const text = await page.locator("body").innerText()

    // then
    expect(text).not.toMatch(/oh[ -]?my[ -]?open[ -]?agent/i)
    expect(text).not.toMatch(/senpi/i)
    expect(text).not.toMatch(/three editions/i)
    await expect(page.getByRole("banner").getByRole("link", { name: "OmO" })).toBeVisible()
  })

  test("renders every section in order, each under its own heading", async ({ page }) => {
    // given
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")

    // when
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-section]")).map((node) =>
        node.getAttribute("data-section"),
      ),
    )

    // then
    expect(order).toEqual([...SECTIONS])
    for (const name of SECTIONS.slice(1)) {
      await expect(
        page.locator(`[data-section="${name}"]`).getByRole("heading", { level: 2 }),
      ).toBeVisible()
    }
  })

  test("lists every messaging platform once", async ({ page }) => {
    // given
    await page.goto("/")
    const list = page.getByTestId("platform-list")

    // when
    const names = await list.locator("li").allInnerTexts()

    // then
    expect(names).toHaveLength(13)
    expect(new Set(names.map((n) => n.trim())).size).toBe(13)
  })

  test("the theme switch pins a theme, keeps it across a reload and System releases it", async ({
    page,
  }) => {
    // given
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto("/")
    const html = page.locator("html")
    const background = (): Promise<string> =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(await background()).toBe("rgb(15, 14, 13)")

    // when
    await page.getByRole("button", { name: "Use the light theme" }).click()

    // then: the palette and the scheme the browser draws its own controls in both follow the pin
    await expect(html).toHaveAttribute("data-theme", "light")
    await expect.poll(background).toBe("rgb(251, 250, 247)")
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
      "light",
    )

    // when
    await page.reload()

    // then
    await expect(html).toHaveAttribute("data-theme", "light")
    await expect(page.getByRole("button", { name: "Use the light theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )

    // when
    await page.getByRole("button", { name: "Use the system theme" }).click()

    // then
    await expect(html).not.toHaveAttribute("data-theme", /./)
    await expect.poll(background).toBe("rgb(15, 14, 13)")
  })

  test("renders the workflow graph in the hero with 10 nodes across 5 waves", async ({ page }) => {
    // given
    await page.goto("/")
    const dag = page.getByTestId("hero-dag")

    // then
    await expect(dag.locator("[data-dag-node]")).toHaveCount(10)
    await expect(dag.locator("[data-dag-wave]")).toHaveCount(5)
    await expect(dag.getByRole("button", { name: "Fit graph" })).toBeVisible()
  })

  test("renders the desktop app window with the graph open in the mass ulw section", async ({
    page,
  }) => {
    // given
    await page.goto("/")
    const dag = page.getByTestId("mass-ulw-graph")

    // when
    await dag.scrollIntoViewIfNeeded()

    // then
    await expect(dag.locator("[data-dag-node]")).toHaveCount(10)
    await expect(dag.locator("[data-dag-wave]")).toHaveCount(5)
    await expect(dag.locator("[data-dag-run-summary]")).toContainText("7 models")
    await expect(dag.getByRole("button", { name: "Fit graph" })).toBeVisible()
  })

  test("the phone menu opens a sheet with every section, the docs and the manifesto", async ({
    page,
  }) => {
    // given
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto("/")
    const sheet = page.locator("#mobile-nav")
    await expect(sheet).toBeHidden()

    // when
    await page.getByRole("button", { name: "Open menu" }).click()

    // then: the whole sheet sits inside the viewport, below the pill
    await expect(sheet).toBeVisible()
    const box = await sheet.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThan(56)
      expect(box.x + box.width).toBeLessThanOrEqual(375)
    }
    await expect(sheet.getByRole("link", { name: "Docs", exact: true })).toBeVisible()
    await expect(sheet.getByRole("link", { name: "Manifesto", exact: true })).toBeVisible()
    await expect(sheet.getByRole("link", { name: "Install", exact: true })).toBeVisible()
  })

  test("a language link keeps the page the reader is on", async ({ page }) => {
    // given
    await page.goto("/manifesto")

    // when
    const korean = page.getByRole("contentinfo").getByRole("link", { name: "한국어" })

    // then
    await expect(korean).toHaveAttribute("href", "/ko/manifesto")
    await expect(korean).toHaveAttribute("hreflang", "ko")
  })

  test("navigates to the docs from the nav and to the manifesto from the footer", async ({
    page,
  }) => {
    // given
    await page.goto("/")

    // when
    await Promise.all([
      page.waitForURL("**/docs", { timeout: 15000 }),
      page.getByRole("banner").getByRole("link", { name: "Docs", exact: true }).click(),
    ])

    // then
    await expect(page.getByRole("heading", { name: "Configuration Reference" })).toBeVisible()

    // when
    await page.goto("/")
    await Promise.all([
      page.waitForURL("**/manifesto", { timeout: 15000 }),
      page.getByRole("contentinfo").getByRole("link", { name: "Manifesto", exact: true }).click(),
    ])

    // then
    await expect(page.getByRole("heading", { name: "Ultrawork Manifesto" })).toBeVisible()
  })
})
