import type { Page } from "playwright-core"

export type HumanScrollOptions = {
  direction?: "down" | "up"
  distancePx?: number
  chunkMinPx?: number
  chunkMaxPx?: number
  delayBetweenChunksMs?: number
}

export async function humanScroll(page: Page, options: HumanScrollOptions = {}): Promise<void> {
  const direction = options.direction ?? "down"
  const totalDistance = options.distancePx ?? 600
  const chunkMin = options.chunkMinPx ?? 30
  const chunkMax = options.chunkMaxPx ?? 120
  const delayBase = options.delayBetweenChunksMs ?? 50

  const sign = direction === "down" ? 1 : -1
  let scrolled = 0

  while (scrolled < totalDistance) {
    const chunk = randomBetween(chunkMin, chunkMax)
    const remaining = totalDistance - scrolled
    const actualChunk = Math.min(chunk, remaining)

    await page.mouse.wheel(0, sign * actualChunk)
    scrolled += actualChunk

    const delay = delayBase + Math.random() * delayBase
    await new Promise(resolve => setTimeout(resolve, delay))
  }
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
