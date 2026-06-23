import type { Page, ElementHandle } from "playwright-core"

export type HumanClickOptions = {
  jitterPx?: number
  preClickDelayMs?: number
}

export type CoordTarget = { x: number; y: number }

export type HumanClickTarget = string | ElementHandle | CoordTarget

export async function humanClick(
  page: Page,
  target: HumanClickTarget,
  options: HumanClickOptions = {},
): Promise<void> {
  const jitter = options.jitterPx ?? 3

  const resolved = await resolveTargetCoords(page, target, jitter)
  const steps = fittsSteps(resolved.size, resolved.size)

  await page.mouse.move(resolved.x, resolved.y, { steps })

  const preDelay = options.preClickDelayMs ?? randomBetween(50, 150)
  if (preDelay > 0) {
    await new Promise(resolve => setTimeout(resolve, preDelay))
  }

  await page.mouse.click(resolved.x, resolved.y)
}

type ResolvedTarget = { x: number; y: number; size: number }

async function resolveTargetCoords(
  page: Page,
  target: HumanClickTarget,
  jitter: number,
): Promise<ResolvedTarget> {
  if (isCoordTarget(target)) {
    return {
      x: target.x + randomOffset(jitter),
      y: target.y + randomOffset(jitter),
      size: 1,
    }
  }

  const element = typeof target === "string"
    ? await page.waitForSelector(target, { state: "visible", timeout: 10_000 })
    : target

  if (!element) throw new Error(`Element not found: ${String(target)}`)

  const box = await element.boundingBox()
  if (!box) throw new Error("Element has no bounding box (hidden or zero-size)")

  return {
    x: box.x + box.width / 2 + randomOffset(jitter),
    y: box.y + box.height / 2 + randomOffset(jitter),
    size: Math.max(box.width, box.height, 1),
  }
}

function isCoordTarget(target: HumanClickTarget): target is CoordTarget {
  return typeof target === "object"
    && target !== null
    && typeof (target as CoordTarget).x === "number"
    && typeof (target as CoordTarget).y === "number"
}

function fittsSteps(width: number, height: number): number {
  const size = Math.max(width, height, 1)
  const distance = 200
  const fittsIndex = Math.log2(distance / size + 1)
  return Math.max(5, Math.min(30, Math.round(fittsIndex * 5)))
}

function randomOffset(maxPx: number): number {
  return (Math.random() - 0.5) * 2 * maxPx
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
