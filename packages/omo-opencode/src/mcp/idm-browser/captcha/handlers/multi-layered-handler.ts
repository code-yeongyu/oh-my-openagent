import type { CapsolverTaskHandler } from "../registry-types"

const DIAGNOSTIC = "site uses Firebase Auth + reCAPTCHA Enterprise + hCaptcha; current chain only covers hCaptcha; need either browser-resident solver OR session warmup OR Firebase token capture"

export const multiLayeredFirebaseHandler: CapsolverTaskHandler = {
  taskType: "HCaptchaTask",
  extract: async () => {
    console.error(JSON.stringify({ level: "error", component: "captcha", kind: "multi_layered_firebase_recaptcha_hcaptcha", message: DIAGNOSTIC }))
    return null
  },
  inject: async () => false,
}

export { DIAGNOSTIC as MULTI_LAYERED_FIREBASE_DIAGNOSTIC }
