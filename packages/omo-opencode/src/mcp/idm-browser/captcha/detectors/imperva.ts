import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectImperva(page: Page): Promise<DetectedChallenge | null> {
  const incapsula = await page.evaluate(() => {
    return Array.from(document.scripts).some((s) => /_Incapsula_Resource|Incapsula\.com/i.test(s.src + s.textContent))
      || Boolean(document.querySelector("iframe[src*='_Incapsula_Resource']"))
  })
  if (incapsula) {
    return { kind: "imperva", confidence: 0.85, selector: "body" }
  }
  return null
}
