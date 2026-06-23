import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectMtCaptcha(page: Page): Promise<DetectedChallenge | null> {
  const widget = await page.$(".mtcaptcha-iframe-container, .mtcaptcha")
  if (widget) {
    return { kind: "mtcaptcha", confidence: 0.92, selector: ".mtcaptcha" }
  }
  const global = await page.evaluate(() => {
    const w = window as unknown as { mtcaptchaConfig?: unknown }
    return Boolean(w.mtcaptchaConfig)
  })
  if (global) {
    return { kind: "mtcaptcha", confidence: 0.8, selector: "body" }
  }
  return null
}
