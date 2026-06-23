import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectFriendlyCaptcha(page: Page): Promise<DetectedChallenge | null> {
  const widget = await page.$(".frc-captcha, [data-puzzle], [data-sitekey][class*='frc']")
  if (widget) {
    return { kind: "friendly_captcha", confidence: 0.9, selector: ".frc-captcha" }
  }
  return null
}
