import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectDataDome(page: Page): Promise<DetectedChallenge | null> {
  const slider = await page.$("iframe[src*='captcha-delivery.com'][src*='dd-captcha'], iframe[src*='geo.captcha-delivery.com'][src*='slider']")
  if (slider) {
    return { kind: "datadome_slider", confidence: 0.92, selector: "iframe[src*='captcha-delivery.com']" }
  }

  const generic = await page.$("iframe[src*='datadome'], iframe[src*='captcha-delivery.com']")
  if (generic) {
    return { kind: "datadome", confidence: 0.9, selector: "iframe[src*='datadome']" }
  }

  return null
}
