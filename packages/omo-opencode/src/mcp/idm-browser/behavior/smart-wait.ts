/// <reference lib="dom" />
import type { Page } from "playwright-core"

export type WaitStrategy = "networkidle" | "domstable" | "selector" | "fixed"

export type SmartWaitOptions = {
  strategy?: WaitStrategy
  selector?: string
  timeoutMs?: number
  fixedMs?: number
}

export async function smartWait(page: Page, options: SmartWaitOptions = {}): Promise<void> {
  const strategy = options.strategy ?? "domstable"
  const timeoutMs = options.timeoutMs ?? 10_000

  switch (strategy) {
    case "networkidle":
      await page.waitForLoadState("networkidle", { timeout: timeoutMs })
      break

    case "domstable":
      await waitForDomStable(page, timeoutMs)
      break

    case "selector":
      if (!options.selector) throw new Error("selector strategy requires a selector")
      await page.waitForSelector(options.selector, { timeout: timeoutMs, state: "visible" })
      break

    case "fixed":
      await new Promise(resolve => setTimeout(resolve, options.fixedMs ?? 1000))
      break
  }
}

async function waitForDomStable(page: Page, timeoutMs: number): Promise<void> {
  const pollInterval = 200
  const stableThreshold = 3

  let lastLength = 0
  let stableCount = 0
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const currentLength = await page.evaluate(() => document.body?.innerHTML?.length ?? 0)

    if (currentLength === lastLength) {
      stableCount++
      if (stableCount >= stableThreshold) return
    } else {
      stableCount = 0
      lastLength = currentLength
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval))
  }
}
