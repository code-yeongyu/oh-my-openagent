import { test, expect } from "@playwright/test"

const STORY_SECTIONS = [
  "secret",
  "ultrawork",
  "multi-model",
  "mass-ulw",
  "kibitzer",
  "skills",
  "crafted",
  "platforms",
] as const

test.describe("Landing Page", () => {
  test("renders hero section with title and CTA", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    const heading = page.getByRole("heading", { name: /Your tool for real work\./, level: 1 })
    const getStarted = page.getByRole("link", { name: "Get started" })
    const readManifesto = page.getByRole("link", { name: "Read the manifesto" })

    // then
    await expect(page).toHaveTitle(/OmO/)
    await expect(heading).toBeVisible()
    await expect(heading).toContainText("But it's an agent.")
    await expect(getStarted).toBeVisible()
    await expect(getStarted).toHaveAttribute("href", /\/docs#installation$/)
    await expect(readManifesto).toBeVisible()
  })

  test("renders exactly one install command in the hero", async ({ page }) => {
    // given
    await page.goto("/")
    const hero = page.locator('[data-section="hero"]')

    // then
    await expect(hero.getByTestId("command-bar")).toHaveCount(1)
    await expect(hero.getByText("bun install -g omo-ai@beta")).toBeVisible()
    await expect(hero.getByRole("button", { name: "Copy install command" })).toBeVisible()
    await expect(hero.getByRole("tab")).toHaveCount(0)
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

  test("renders the story sections in order without numeric labels", async ({ page }) => {
    // given
    await page.goto("/")

    // when
    const order = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-section]")).map((node) =>
        node.getAttribute("data-section"),
      ),
    )

    // then
    const storyOrder = order.filter((name): name is (typeof STORY_SECTIONS)[number] =>
      (STORY_SECTIONS as readonly string[]).includes(name ?? ""),
    )
    expect(storyOrder).toEqual([...STORY_SECTIONS])
    for (const name of STORY_SECTIONS) {
      const section = page.locator(`[data-section="${name}"]`)
      await section.scrollIntoViewIfNeeded()
      await expect(section.getByRole("heading", { level: 2 })).toBeVisible()
      const eyebrows = await section.locator(".eyebrow").allInnerTexts()
      for (const eyebrow of eyebrows) {
        expect(eyebrow).not.toMatch(/^\d{2}\b/)
      }
    }
  })

  test("lists every messaging platform once", async ({ page }) => {
    // given
    await page.goto("/")
    const list = page.getByTestId("platform-list")

    // when
    await list.scrollIntoViewIfNeeded()
    const names = await list.locator("li").allInnerTexts()

    // then
    expect(names).toHaveLength(13)
    expect(new Set(names.map((n) => n.trim())).size).toBe(13)
  })

  test("keeps the story readable under reduced motion", async ({ page }) => {
    // given
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/")

    // when
    const marquee = page.getByTestId("model-marquee").locator(".marquee-track").first()
    await marquee.scrollIntoViewIfNeeded()
    const animation = await marquee.evaluate((node) => getComputedStyle(node).animationName)
    const litWords = page.locator('[data-section="secret"] .lit-word')
    await litWords.first().scrollIntoViewIfNeeded()
    const faintWords = await litWords.evaluateAll(
      (nodes) => nodes.filter((node) => !node.classList.contains("is-lit")).length,
    )

    // then
    expect(animation).toBe("none")
    expect(faintWords).toBe(0)
  })

  test("runs independent Kibitzer loops and inserts a static nudge under reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await page.goto("/")
    const stage = page.getByTestId("kibitzer-stage")
    await stage.scrollIntoViewIfNeeded()
    await expect(stage).toHaveAttribute("data-running", "true")
    await expect(stage.locator("[data-kib-nudge]")).toHaveCount(1)
    for (const column of ["side", "main"]) {
      const names = await stage
        .locator(`[data-kib-column="${column}"] *`)
        .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).animationName))
      expect(names.some((name) => name !== "none")).toBe(true)
    }

    await page.emulateMedia({ reducedMotion: "reduce" })
    const names = await stage
      .locator("*")
      .evaluateAll((nodes) =>
        nodes.flatMap((node) => [
          getComputedStyle(node).animationName,
          getComputedStyle(node, "::before").animationName,
          getComputedStyle(node, "::after").animationName,
        ]),
      )
    expect(names.every((name) => name === "none")).toBe(true)
    await expect(stage.locator("[data-kib-nudge]")).toBeVisible()
    await expect(stage.locator("[data-kib-nudge]")).toHaveCSS("opacity", "1")
    await expect(stage.locator(".kib-after")).toHaveCSS("opacity", "1")
    await expect(stage.locator(".kib-before")).toBeHidden()
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
