import type { BrowserContext, Page } from "playwright-core"

export type WindowSize = [number, number]

export function attachViewportCoherence(context: BrowserContext, window: WindowSize | undefined): void {
  if (!window) return
  const [width, height] = window
  const apply = async (page: Page) => {
    try {
      await page.setViewportSize({ width, height })
    } catch {
      void 0
    }
  }
  for (const page of context.pages()) {
    void apply(page)
  }
  context.on("page", (page) => {
    void apply(page)
  })
}
