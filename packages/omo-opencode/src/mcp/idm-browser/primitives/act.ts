import type { Page } from "playwright-core"
import type { ActionCache } from "./action-cache"
import { resolveSelector } from "./selector-resolver"

export type ActResult = {
  success: boolean
  selector: string
  source: "cache" | "llm" | "heuristic"
  error?: string
}

export async function act(
  page: Page,
  instruction: string,
  cache: ActionCache | null,
  options: { timeoutMs?: number; noCache?: boolean } = {},
): Promise<ActResult> {
  const url = page.url()
  const urlPattern = new URL(url).hostname + "/*"

  const resolved = await resolveSelector(
    instruction,
    urlPattern,
    "",
    options.noCache ? null : cache,
  )

  try {
    const element = await page.waitForSelector(resolved.selector, {
      timeout: options.timeoutMs ?? 15_000,
      state: "visible",
    })

    if (!element) {
      return { success: false, selector: resolved.selector, source: resolved.source, error: "Element not found" }
    }

    const tagName = await element.evaluate(el => el.tagName.toLowerCase())

    if (tagName === "input" || tagName === "textarea" || tagName === "select") {
      const valueMatch = instruction.match(/type\s+["']?(.+?)["']?\s+into/i)
      if (valueMatch) {
        await element.fill(valueMatch[1]!)
      } else {
        await element.click()
      }
    } else {
      await element.click()
    }

    if (cache && !options.noCache) {
      cache.store(instruction, urlPattern, resolved.selector)
    }

    return { success: true, selector: resolved.selector, source: resolved.source }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, selector: resolved.selector, source: resolved.source, error: message }
  }
}
