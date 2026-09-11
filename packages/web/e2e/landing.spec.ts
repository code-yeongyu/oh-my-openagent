import { test, expect } from "@playwright/test"

test.describe("Landing Page", () => {
  test("renders hero section with title and CTA", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    const heading = page.getByRole("heading", { name: /Type mass ulw\./, level: 1 })
    const getStarted = page.getByRole("link", { name: "Get started" })
    const readManifesto = page.getByRole("link", { name: "Read the manifesto" })

    // then
    await expect(page).toHaveTitle(/Oh My OpenAgent/)
    await expect(heading).toBeVisible()
    await expect(heading).toContainText("Own the graph.")
    await expect(getStarted).toBeVisible()
    await expect(getStarted).toHaveAttribute("href", /\/docs#installation$/)
    await expect(readManifesto).toBeVisible()
  })

  test("renders install command with host tabs", async ({ page }) => {
    // given
    await page.goto("/")
    const hero = page.locator('[data-section="hero"]')

    // when
    const installCommand = hero.getByText("bunx oh-my-openagent install")

    // then
    await expect(installCommand).toBeVisible()
    await expect(hero.getByRole("button", { name: "Copy install command" })).toBeVisible()

    // when
    await hero.getByRole("tab", { name: "Codex" }).click()

    // then
    await expect(hero.getByText("npx lazycodex-ai install")).toBeVisible()

    // when
    await hero.getByRole("tab", { name: "Senpi" }).click()

    // then
    await expect(hero.getByText("npm i -g omo-ai@beta")).toBeVisible()
  })

  test("renders the agent bento cells", async ({ page }) => {
    // given
    await page.goto("/")
    const grid = page.locator("#agents ul")

    // when / then
    await expect(grid.locator("li[id^='agent-']")).toHaveCount(12)
    const agentNames = [
      "Orchestrator",
      "Ultrawork Planner",
      "Plan Consultant",
      "Plan Reviewer",
      "Kibitzer",
      "Architect",
      "Deep",
      "Quick",
      "Visual Engineering",
      "Explore",
      "Librarian",
      "Dynamic Agent",
    ]
    for (const name of agentNames) {
      await expect(grid.getByRole("heading", { name, exact: true })).toBeVisible()
    }
    await expect(grid.getByText("Profiles: Capable · Simple work · Deep work")).toBeVisible()
  })

  test("keeps the agent bento grid hole-free at desktop and phone widths", async ({ page }) => {
    const viewports = [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]

    for (const viewport of viewports) {
      // given
      await page.setViewportSize(viewport)
      await page.goto("/")
      const grid = page.locator("#agents ul")
      const cells = grid.locator("li[id^='agent-']")

      // when
      await expect(cells).toHaveCount(12)
      await grid.scrollIntoViewIfNeeded()
      await page.evaluate(() => document.fonts.ready)
      for (let i = 0; i < 12; i += 1) {
        const cell = cells.nth(i)
        await expect(cell).toBeVisible()
        const box = await cell.boundingBox()
        if (!box) {
          throw new Error(
            `agent cell ${i} has no bounding box at ${viewport.width}x${viewport.height}`,
          )
        }
      }

      // then: no two cells share area (the gapless bento has no overlaps and no holes).
      // One synchronous snapshot: the scroll-driven reveal transform would otherwise
      // shift cells between separate boundingBox() round-trips.
      const rects = await cells.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect()
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        }),
      )
      for (let i = 0; i < rects.length; i += 1) {
        const a = rects[i]
        if (!a) continue
        for (let j = i + 1; j < rects.length; j += 1) {
          const b = rects[j]
          if (!b) continue
          const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
          const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
          const overlapArea = Math.max(0, overlapX) * Math.max(0, overlapY)
          if (overlapArea > 0) {
            throw new Error(
              `agent cells ${i} and ${j} overlap by ${overlapArea}px^2 at ${viewport.width}x${viewport.height}`,
            )
          }
        }
      }
    }
  })

  test("renders the model profiles ledger at desktop and phone widths", async ({ page }) => {
    const viewports = [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]

    for (const viewport of viewports) {
      // given
      await page.setViewportSize(viewport)
      await page.goto("/")
      const section = page.locator("#profiles")

      // when
      await section.scrollIntoViewIfNeeded()
      await page.evaluate(() => document.fonts.ready)

      // then: the section heading and all three builtin profile names are visible.
      await expect(
        section.getByRole("heading", { name: "Pick the intent, not the model.", level: 2 }),
      ).toBeVisible()
      const profileNames = ["Capable", "Simple work", "Deep work"]
      for (const name of profileNames) {
        await expect(section.getByRole("heading", { name, exact: true })).toBeVisible()
      }

      // and: the ledger sits strictly after the agent bento grid - no shared area at either width.
      // One synchronous snapshot, same as the grid-integrity case: the scroll-driven reveal
      // transform would otherwise shift boxes between separate boundingBox() round-trips.
      const overlapArea = await page.evaluate(() => {
        const grid = document.querySelector("#agents ul")
        const profiles = document.querySelector("#profiles")
        if (!(grid instanceof HTMLElement) || !(profiles instanceof HTMLElement)) {
          throw new Error("landing must render #agents ul and #profiles")
        }
        const gridRect = grid.getBoundingClientRect()
        const profilesRect = profiles.getBoundingClientRect()
        const overlapX =
          Math.min(gridRect.right, profilesRect.right) - Math.max(gridRect.left, profilesRect.left)
        const overlapY =
          Math.min(gridRect.bottom, profilesRect.bottom) - Math.max(gridRect.top, profilesRect.top)
        return Math.max(0, overlapX) * Math.max(0, overlapY)
      })
      if (overlapArea > 0) {
        throw new Error(
          `profiles section overlaps the agents grid by ${overlapArea}px^2 at ${viewport.width}x${viewport.height}`,
        )
      }
    }
  })

  test("renders the desktop DAG view in the hero with 10 nodes across 5 waves", async ({
    page,
  }) => {
    // given
    await page.goto("/")
    const dag = page.getByTestId("hero-dag")

    // then
    await expect(dag.locator("[data-dag-node]")).toHaveCount(10)
    await expect(dag.locator("[data-dag-wave]")).toHaveCount(5)
    await expect(dag.getByRole("button", { name: "Fit graph" })).toBeVisible()
  })

  test("renders the desktop app window with the DAG open in the mass ulw section", async ({
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

  test("mobile nav toggles menu", async ({ page }) => {
    // given
    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto("/")

    const mobileNav = page.locator("#mobile-nav")
    await expect(mobileNav).toBeHidden()

    // when
    await page.getByRole("button", { name: "Open menu" }).click()

    // then
    await expect(mobileNav).toBeVisible()
    await expect(mobileNav.getByRole("link", { name: "Docs", exact: true })).toBeVisible()
    await expect(mobileNav.getByRole("link", { name: "Manifesto", exact: true })).toBeVisible()
  })

  test("navigates to docs page", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    await Promise.all([
      page.waitForURL("**/docs", { timeout: 15000 }),
      page.getByRole("banner").getByRole("link", { name: "Docs", exact: true }).click(),
    ])

    // then
    await expect(page).toHaveURL(/\/docs/)
    await expect(page.getByRole("heading", { name: "Configuration Reference" })).toBeVisible()
  })

  test("navigates to manifesto page", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    await Promise.all([
      page.waitForURL("**/manifesto", { timeout: 15000 }),
      page.getByRole("banner").getByRole("link", { name: "Manifesto", exact: true }).click(),
    ])

    // then
    await expect(page).toHaveURL(/\/manifesto/)
    await expect(page.getByRole("heading", { name: "Ultrawork Manifesto" })).toBeVisible()
  })
})
