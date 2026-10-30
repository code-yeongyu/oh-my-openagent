import { expect, test } from "@playwright/test"

const RING_COLOR = "rgb(0, 212, 255)"
const MAX_TAB_STOPS = 60

type FocusedRing = {
  readonly element: string
  readonly outlineStyle: string
  readonly outlineWidth: number
  readonly outlineColor: string
  readonly opacity: number
}

for (const route of ["/", "/docs", "/manifesto"]) {
  test(`every keyboard focus stop on ${route} draws the focus ring`, async ({ page }) => {
    // given
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto(route)
    await page.locator("body").focus()
    const stops: FocusedRing[] = []

    // when
    for (let index = 0; index < MAX_TAB_STOPS; index++) {
      await page.keyboard.press("Tab")
      const ring = await page.evaluate((): FocusedRing | null => {
        const element = document.activeElement
        if (!(element instanceof HTMLElement) || element === document.body) return null
        const style = getComputedStyle(element)
        const label = element.getAttribute("aria-label") ?? element.textContent ?? ""
        return {
          element: `${element.tagName.toLowerCase()} "${label.trim().slice(0, 40)}"`,
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
          outlineColor: style.outlineColor,
          opacity: (() => {
            let value = 1
            for (let node: Element | null = element; node; node = node.parentElement) {
              value *= Number(getComputedStyle(node).opacity)
            }
            return value
          })(),
        }
      })
      if (ring === null) break
      stops.push(ring)
    }

    // then
    expect(stops.length).toBeGreaterThan(3)
    const missing = stops.filter(
      (stop) =>
        stop.outlineStyle === "none" ||
        stop.outlineWidth < 2 ||
        stop.outlineColor !== RING_COLOR ||
        stop.opacity < 1,
    )
    expect(missing).toEqual([])
  })
}
