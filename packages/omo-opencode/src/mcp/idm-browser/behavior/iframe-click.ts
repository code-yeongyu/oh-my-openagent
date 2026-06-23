import type { Page } from "playwright-core"
import { humanClick, type HumanClickOptions } from "./human-click"

export async function clickInsideIframe(
  page: Page,
  iframeSelector: string,
  offsetX: number,
  offsetY: number,
  options: HumanClickOptions = {},
): Promise<{ x: number; y: number }> {
  const handle = await page.$(iframeSelector)
  if (!handle) {
    throw new Error(`clickInsideIframe: iframe not found for selector ${iframeSelector}`)
  }
  const box = await handle.boundingBox()
  if (!box) {
    throw new Error(`clickInsideIframe: iframe has no bounding box (${iframeSelector})`)
  }

  const target = { x: box.x + offsetX, y: box.y + offsetY }
  await humanClick(page, target, options)
  return target
}
