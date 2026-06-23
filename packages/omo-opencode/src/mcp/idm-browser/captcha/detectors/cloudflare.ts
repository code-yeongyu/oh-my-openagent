import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectCloudflare(page: Page): Promise<DetectedChallenge | null> {
  const hasTurnstileFrame = await page.$("iframe[src*='challenges.cloudflare.com']")
  if (hasTurnstileFrame) {
    return { kind: "cloudflare_turnstile", confidence: 0.95, selector: "iframe[src*='challenges.cloudflare.com']" }
  }

  const hasTurnstileWidget = await page.$('.cf-turnstile, input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]')
  if (hasTurnstileWidget) {
    return { kind: "cloudflare_turnstile", confidence: 0.85, selector: ".cf-turnstile" }
  }

  const hasInterstitial = await page.$("#challenge-running, #challenge-form, #challenge-stage")
  if (hasInterstitial) {
    return { kind: "cloudflare_interstitial", confidence: 0.9, selector: "#challenge-running" }
  }

  const hasUamTitle = await page.evaluate(() => /just a moment|verifica di sicurezza|esecuzione della verifica/i.test(document.title || ""))
  if (hasUamTitle) {
    return { kind: "cloudflare_interstitial", confidence: 0.8, selector: "body" }
  }

  return null
}
