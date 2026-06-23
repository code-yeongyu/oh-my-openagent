import type { Page, ElementHandle } from "playwright-core"

export type HumanTypeOptions = {
  baseDelayMs?: number
  varianceMs?: number
  mistakeRate?: number
}

export async function humanType(
  page: Page,
  target: string | ElementHandle,
  text: string,
  options: HumanTypeOptions = {},
): Promise<void> {
  const element = typeof target === "string"
    ? await page.waitForSelector(target, { state: "visible", timeout: 10_000 })
    : target

  if (!element) throw new Error(`Element not found: ${target}`)

  await element.click()

  const baseDelay = options.baseDelayMs ?? 80
  const variance = options.varianceMs ?? 40
  const mistakeRate = options.mistakeRate ?? 0.02

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!

    if (Math.random() < mistakeRate && i > 0) {
      const wrongChar = String.fromCharCode(char.charCodeAt(0) + randomIntBetween(-2, 2))
      await page.keyboard.type(wrongChar, { delay: ngramDelay(baseDelay, variance) })
      await new Promise(resolve => setTimeout(resolve, randomIntBetween(100, 300)))
      await page.keyboard.press("Backspace")
      await new Promise(resolve => setTimeout(resolve, randomIntBetween(50, 120)))
    }

    const delay = ngramDelay(baseDelay, variance)
    await page.keyboard.type(char, { delay })
  }
}

function ngramDelay(base: number, variance: number): number {
  const gaussian = (Math.random() + Math.random() + Math.random()) / 3
  return Math.max(20, base + (gaussian - 0.5) * 2 * variance)
}

function randomIntBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1))
}
