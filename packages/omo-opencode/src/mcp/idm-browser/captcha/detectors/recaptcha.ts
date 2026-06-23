import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectRecaptcha(page: Page): Promise<DetectedChallenge | null> {
  const enterpriseInfo = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll("iframe[src*='/recaptcha/enterprise/anchor']")) as HTMLIFrameElement[]
    if (iframes.length === 0) return null
    const hasVisible = iframes.some((f) => !f.src.includes("size=invisible"))
    const hasInvisible = iframes.some((f) => f.src.includes("size=invisible"))
    return { hasVisible, hasInvisible }
  })
  if (enterpriseInfo?.hasVisible) {
    return { kind: "recaptcha_enterprise", confidence: 0.93, selector: "iframe[src*='/recaptcha/enterprise/anchor']" }
  }
  if (enterpriseInfo?.hasInvisible) {
    return {
      kind: "recaptcha_enterprise_invisible",
      confidence: 0.93,
      selector: "iframe[src*='/recaptcha/enterprise/anchor'][src*='size=invisible']",
    }
  }

  const v2Anchor = await page.$("iframe[src*='/recaptcha/api2/anchor'], iframe[src*='google.com/recaptcha']")
  if (v2Anchor) {
    return { kind: "recaptcha_v2_checkbox", confidence: 0.9, selector: "iframe[src*='recaptcha']" }
  }

  const badgeKind = await page.evaluate(() => {
    const badge = document.querySelector(".grecaptcha-badge")
    if (!badge) return null
    const w = window as unknown as {
      grecaptcha?: {
        execute?: unknown
        enterprise?: { execute?: unknown }
      }
    }
    if (typeof w.grecaptcha?.enterprise?.execute === "function") return "recaptcha_v3_executable"
    if (typeof w.grecaptcha?.execute === "function") return "recaptcha_v3_executable"
    return "recaptcha_v3_invisible"
  })
  if (badgeKind === "recaptcha_v3_executable") {
    return { kind: "recaptcha_v3_executable", confidence: 0.85, selector: ".grecaptcha-badge" }
  }
  if (badgeKind === "recaptcha_v3_invisible") {
    return { kind: "recaptcha_v3_invisible", confidence: 0.7, selector: ".grecaptcha-badge" }
  }

  return null
}
