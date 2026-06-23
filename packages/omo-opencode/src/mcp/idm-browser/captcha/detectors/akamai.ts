import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectAkamai(page: Page): Promise<DetectedChallenge | null> {
  const cookieEvidence = await page.evaluate(() => {
    return document.cookie.split(";").some((c) => c.trim().startsWith("_abck="))
  })
  if (!cookieEvidence) return null

  const bmpScript = await page.evaluate(() => {
    return Array.from(document.scripts).some((s) => /bmak\.bm\b|akamai-bm-telemetry/i.test(s.textContent ?? ""))
  })
  if (bmpScript) {
    return { kind: "akamai_bmp", confidence: 0.85, selector: "body" }
  }

  const webChallenge = await page.evaluate(() => {
    return Boolean(document.querySelector("script[src*='/akam/']"))
      || Array.from(document.scripts).some((s) => /akamaihd|akamaiedge/i.test(s.src))
  })
  if (webChallenge) {
    return { kind: "akamai_web", confidence: 0.7, selector: "body" }
  }

  return null
}
