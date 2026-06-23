import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"
import type { ChallengeKind } from "../../types"

export async function detectHCaptcha(page: Page): Promise<DetectedChallenge | null> {
  const variant = await classifyHCaptchaVariant(page)
  if (!variant) return null
  return { kind: variant.kind, confidence: variant.confidence, selector: "iframe[src*='hcaptcha.com']" }
}

async function classifyHCaptchaVariant(page: Page): Promise<{ kind: ChallengeKind; confidence: number } | null> {
  const has = await page.$("iframe[src*='hcaptcha.com']")
  if (!has) return null

  const enterprise = await page.evaluate(() => {
    const div = document.querySelector("[data-sitekey]") as HTMLElement | null
    if (!div) return false
    const sk = div.getAttribute("data-sitekey") ?? ""
    if (sk.startsWith("4c672")) return true
    return Boolean(div.getAttribute("data-hcaptcha-widget-data"))
  })
  if (enterprise) {
    return { kind: "hcaptcha_enterprise", confidence: 0.86 }
  }

  const turbo = await page.evaluate(() => {
    const div = document.querySelector("[data-sitekey]") as HTMLElement | null
    if (!div) return false
    return div.getAttribute("data-size") === "invisible"
      || div.classList.contains("h-captcha-turbo")
      || Boolean(document.querySelector("script[src*='turbo']"))
  })
  if (turbo) {
    return { kind: "hcaptcha_turbo", confidence: 0.82 }
  }

  return { kind: "hcaptcha_checkbox", confidence: 0.9 }
}
