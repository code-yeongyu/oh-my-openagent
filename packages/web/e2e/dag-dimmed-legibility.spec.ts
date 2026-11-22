import { expect, test } from "@playwright/test"

test("nodes off the focused DAG path stay legible at 4.5:1", async ({ page }) => {
  // given
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.goto("/")
  const dag = page.getByTestId("hero-dag")
  await expect(dag.locator("[data-dag-node]")).toHaveCount(10)

  const nodes = dag.locator("[data-dag-node]")
  const dimmed = dag.locator('[data-dag-node][data-dimmed="true"]')

  // when
  for (let index = (await nodes.count()) - 1; index >= 0; index--) {
    await nodes.nth(index).hover()
    if ((await dimmed.count()) > 0) break
  }

  // then
  await expect(dimmed.first()).toBeVisible()
  const failures = await dimmed.evaluateAll((nodes) => {
    const channels = (color: string): number[] =>
      (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const luminance = (color: string): number => {
      const [r = 0, g = 0, b = 0] = channels(color).map((value) => {
        const srgb = value / 255
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const effectiveOpacity = (element: Element, root: Element): number => {
      let opacity = 1
      for (
        let at: Element | null = element;
        at && at !== root.parentElement;
        at = at.parentElement
      ) {
        opacity *= Number(getComputedStyle(at).opacity)
      }
      return opacity
    }
    return nodes.flatMap((node) => {
      const background = luminance(getComputedStyle(node).backgroundColor)
      return [...node.querySelectorAll("span")]
        .filter(
          (span) =>
            span.children.length === 0 &&
            span.textContent?.trim() &&
            !span.closest('[aria-hidden="true"]'),
        )
        .flatMap((span) => {
          const text = luminance(getComputedStyle(span).color)
          const ratio = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05)
          const opacity = effectiveOpacity(span, node)
          return ratio >= 4.5 && opacity === 1
            ? []
            : [{ text: span.textContent, ratio: Number(ratio.toFixed(2)), opacity }]
        })
    })
  })
  expect(failures).toEqual([])
})
