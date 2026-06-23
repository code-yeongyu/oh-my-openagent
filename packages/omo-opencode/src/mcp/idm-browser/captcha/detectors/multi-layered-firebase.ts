import type { Page } from "playwright-core"
import type { DetectedChallenge } from "../detect-types"

export async function detectMultiLayeredFirebase(page: Page): Promise<DetectedChallenge | null> {
  const hasSignals = await page.evaluate(() => {
    const win = window as unknown as { firebase?: { auth?: unknown }; hcaptcha?: unknown }
    const hasGlobals = Boolean(win.firebase?.auth && win.hcaptcha)
    const scriptNodes = document.querySelectorAll("script[src]")
    const scripts: string[] = []
    for (let index = 0; index < scriptNodes.length; index++) {
      const script = scriptNodes.item(index) as HTMLScriptElement
      scripts.push(script.src)
    }
    const hasHCaptchaScript = scripts.some((src) => src.includes("js.hcaptcha.com/1/api.js"))
    const hasFirebaseRecaptcha = scripts.some((src) => src.includes("identitytoolkit.googleapis.com/v2/recaptchaConfig"))
    return hasGlobals || (hasHCaptchaScript && hasFirebaseRecaptcha)
  }).catch(() => false)
  if (!hasSignals) return null
  return {
    kind: "multi_layered_firebase_recaptcha_hcaptcha",
    confidence: 0.85,
    selector: "iframe[src*='hcaptcha'], script[src*='identitytoolkit.googleapis.com/v2/recaptchaConfig']",
  }
}
