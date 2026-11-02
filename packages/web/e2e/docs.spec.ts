import { test, expect } from "@playwright/test"

test.describe("Docs Page", () => {
  test("renders sidebar and config reference", async ({ page }) => {
    // given
    await page.goto("/docs")

    // when
    const heading = page.getByRole("heading", { name: "Configuration Reference" })
    const sidebarItems = [
      "Overview",
      "Installation",
      "Orchestration",
      "Agent / Model Matching",
      "Team Mode",
      "CLI Reference",
      "Configuration",
      "Features",
      "Manifesto",
    ]

    // then
    await expect(heading).toBeVisible()
    for (const item of sidebarItems) {
      await expect(page.getByRole("button", { name: item })).toBeVisible()
    }
  })

  test("has working search input", async ({ page }) => {
    // given
    await page.goto("/docs")
    const searchInput = page.getByPlaceholder("Search docs...")

    // when
    await searchInput.fill("agent")

    // then
    await expect(page.getByRole("button", { name: "Agent / Model Matching" })).toBeVisible()
  })

  test("sidebar navigation scrolls instantly and highlights active section", async ({ page }) => {
    // given
    await page.goto("/docs")
    const installationButton = page.getByRole("button", { name: "Installation" })

    // when
    await installationButton.click()

    // then
    await expect(page).toHaveURL(/\/docs#installation$/)
    await expect(page.locator("#installation")).toBeInViewport()
    await expect(installationButton).toHaveAttribute("data-active", "true")
  })

  test("hash navigation opens the installation section", async ({ page }) => {
    // given / when
    await page.goto("/docs#installation")

    // then
    await expect(page.locator("#installation")).toBeInViewport()
    await expect(page.getByRole("button", { name: "Installation" })).toHaveAttribute(
      "data-active",
      "true",
    )
  })

  test("internal docs links point to section hashes", async ({ page }) => {
    // given
    await page.goto("/docs")
    const installationGuideLink = page.getByRole("link", { name: "Installation Guide" }).first()

    // when
    await installationGuideLink.click()

    // then
    await expect(installationGuideLink).toHaveAttribute("href", "#installation")
    await expect(page).toHaveURL(/\/docs#installation$/)
    await expect(page.locator("#installation")).toBeInViewport()
  })

  test("legacy Korean installation URL redirects to the docs section", async ({ page }) => {
    // given / when
    await page.goto("/ko/installation.md")

    // then
    await expect(page).toHaveURL(/\/ko\/docs#installation$/)
    await expect(page.locator("#installation")).toBeInViewport()
  })

  test("has no horizontal overflow at 375px", async ({ page }) => {
    // given
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/docs")

    // when
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )

    // then
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test("the install page shows the commands, the guide and its own sidebar", async ({ page }) => {
    // given
    await page.goto("/docs/install")

    // then
    await expect(page).toHaveTitle(/Install OmO/)
    await expect(page.getByRole("heading", { name: "Install OmO", level: 1 })).toBeVisible()
    await expect(page.getByRole("tab")).toHaveCount(3)
    for (const section of ["Check the install", "Fix your PATH", "Uninstall"]) {
      await expect(page.getByRole("button", { name: section })).toBeVisible()
    }

    // when
    await page.getByRole("button", { name: "Fix your PATH" }).click()

    // then
    await expect(page).toHaveURL(/\/docs\/install#fix-your-path$/)
    await expect(page.locator("#fix-your-path")).toBeInViewport()
  })

  test("each guide page OmO Desktop links to renders its title and sidebar", async ({ page }) => {
    for (const [route, title, section] of [
      ["/docs/workflows", "Workflows", "Start a workflow"],
      ["/docs/agents", "Agents", "The Agents panel in OmO Desktop"],
      ["/docs/keywords", "Keywords", "The keywords"],
      ["/docs/telemetry", "Telemetry", "Turn it off"],
      ["/docs/desktop-updates", "Desktop updates", "Release notes"],
    ] as const) {
      // given / when
      await page.goto(route)

      // then
      await expect(page).toHaveTitle(new RegExp(title))
      await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible()
      await expect(page.getByRole("button", { name: section, exact: true })).toBeVisible()
    }
  })

  test("the old get.omo.dev docs link lands on the install page", async ({ page }) => {
    // given
    await page.goto("/docs/guide/installation")

    // then
    await expect(page).toHaveURL(/\/docs\/install$/)
    await expect(page.getByRole("heading", { name: "Install OmO", level: 1 })).toBeVisible()
  })
})
