import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectArkose(page: Page): Promise<DetectedChallenge | null> {
  const selectors = [
    "iframe[src*='arkoselabs.com']",
    "iframe[src*='funcaptcha.com']",
    "iframe[src*='client-api.arkoselabs.com']",
    "[id*='funcaptcha' i]",
    "[id*='arkose' i]",
  ]
  for (const sel of selectors) {
    const found = await page.$(sel)
    if (found) {
      return { kind: "arkose_funcaptcha", confidence: 0.9, selector: sel }
    }
  }
  return null
}
