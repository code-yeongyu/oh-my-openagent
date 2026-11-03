import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "@playwright/test"

type PrerenderManifest = {
  readonly dynamicRoutes: Record<string, { readonly fallback: string | null | false }>
}

const ROUTES = [
  ["/", "en"],
  ["/ko", "ko"],
  ["/ja", "ja"],
  ["/zh", "zh-CN"],
  ["/pt-BR/docs", "pt-BR"],
] as const

test.describe("Document shell", () => {
  for (const [route, lang] of ROUTES) {
    test(`${route} declares lang="${lang}", a dark colour scheme and the ink tokens`, async ({
      page,
    }) => {
      // given / when
      await page.goto(route)

      // then
      await expect(page.locator("html")).toHaveAttribute("lang", lang)
      const shell = await page.evaluate(() => ({
        colorScheme: getComputedStyle(document.documentElement).colorScheme,
        background: getComputedStyle(document.body).backgroundColor,
        color: getComputedStyle(document.body).color,
      }))
      expect(shell).toEqual({
        colorScheme: "dark",
        background: "rgb(9, 9, 11)",
        color: "rgb(245, 245, 247)",
      })
    })
  }

  test("the first Tab reaches the skip link and Enter moves focus into main", async ({ page }) => {
    // given
    await page.goto("/docs")
    await page.locator("body").focus()

    // when
    await page.keyboard.press("Tab")

    // then
    const skip = page.getByRole("link", { name: "Skip to content" })
    await expect(skip).toBeFocused()
    await expect(skip).toBeInViewport()

    // when
    await page.keyboard.press("Enter")

    // then
    await expect(page.locator("main#main-content")).toBeFocused()
  })

  test("reverse Tab never leaves a focused control under the sticky nav", async ({ page }) => {
    // given
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/manifesto")
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.locator("footer a").last().focus()
    const obscured: string[] = []

    // when
    for (let index = 0; index < 25; index++) {
      await page.keyboard.press("Shift+Tab")
      const verdict = await page.evaluate(() => {
        const focused = document.activeElement
        const header = document.querySelector("header")
        if (!(focused instanceof HTMLElement) || !header || header.contains(focused)) return null
        const rect = focused.getBoundingClientRect()
        const navBottom = header.getBoundingClientRect().bottom
        return rect.top < navBottom - 1 && rect.bottom > 0
          ? `${focused.tagName.toLowerCase()} "${(focused.textContent ?? "").trim().slice(0, 30)}" top ${Math.round(rect.top)} < ${Math.round(navBottom)}`
          : null
      })
      if (verdict !== null) obscured.push(verdict)
    }

    // then
    expect(obscured).toEqual([])
  })

  // On the Cloudflare Worker the incremental cache starts empty, so every request is a cache miss. A route
  // built with `fallback: false` (a `dynamicParams = false` anywhere above it) answers that miss with a 404.
  test("the build leaves every locale route open to on-demand rendering", () => {
    // given
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), ".next/prerender-manifest.json"), "utf8"),
    ) as PrerenderManifest

    // when
    const localeRoutes = Object.entries(manifest.dynamicRoutes).filter(([route]) =>
      route.startsWith("/[locale]"),
    )

    // then
    expect(localeRoutes.length).toBeGreaterThan(0)
    expect(
      localeRoutes.filter(([, entry]) => entry.fallback === false).map(([route]) => route),
    ).toEqual([])
  })

  // The proxy rewrites unprefixed paths into the default locale, so both land on the localized 404.
  for (const [route, lang, skipName, title] of [
    ["/no-such-page", "en", "Skip to content", "This page could not be found."],
    ["/ko/no-such-page", "ko", "본문으로 건너뛰기", "페이지를 찾을 수 없습니다."],
  ] as const) {
    test(`${route} is a ${lang} 404 whose first Tab reaches the skip link`, async ({ page }) => {
      // given / when
      const response = await page.goto(route)

      // then
      expect(response?.status()).toBe(404)
      await expect(page.locator("html")).toHaveAttribute("lang", lang)
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title)

      // when
      await page.locator("body").focus()
      await page.keyboard.press("Tab")

      // then
      await expect(page.getByRole("link", { name: skipName })).toBeFocused()

      // when
      await page.keyboard.press("Enter")

      // then
      await expect(page.locator("main#main-content")).toBeFocused()
    })
  }
})
