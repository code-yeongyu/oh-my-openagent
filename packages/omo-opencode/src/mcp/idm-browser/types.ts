import { z } from "zod"

export const ChallengeKindSchema = z.enum([
  "cloudflare_interstitial",
  "cloudflare_turnstile",
  "recaptcha_v2_checkbox",
  "recaptcha_v2_image",
  "recaptcha_v3_invisible",
  "recaptcha_v3_executable",
  "recaptcha_enterprise",
  "recaptcha_enterprise_invisible",
  "hcaptcha_checkbox",
  "hcaptcha_image_grid",
  "hcaptcha_turbo",
  "hcaptcha_enterprise",
  "multi_layered_firebase_recaptcha_hcaptcha",
  "datadome",
  "datadome_slider",
  "emoji_puzzle",
  "arkose_funcaptcha",
  "image_grid_puzzle",
  "aws_waf",
  "geetest_v3",
  "geetest_v4",
  "mtcaptcha",
  "kasada",
  "akamai_bmp",
  "akamai_web",
  "imperva",
  "binance_captcha",
  "duolingo",
  "friendly_captcha",
  "cybersiara",
  "image_text_ocr",
])
export type ChallengeKind = z.infer<typeof ChallengeKindSchema>

export const EngineNameSchema = z.enum(["camoufox", "patchright", "lightpanda", "cloakbrowser"])
export type EngineName = z.infer<typeof EngineNameSchema>

export class BotBlockedError extends Error {
  constructor(
    public readonly kind: string,
    public readonly profileDir: string,
    public readonly evidence: { screenshotPath?: string; headers?: Record<string, string> } = {},
  ) {
    super(`Bot block detected: ${kind}`)
    this.name = "BotBlockedError"
  }
}

export class RawInteractionForbiddenError extends Error {
  constructor(method: string) {
    super(`Raw page.${method}() called outside behavior layer. Use humanClick/humanType.`)
    this.name = "RawInteractionForbiddenError"
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly host: string, public readonly retryAfterMs: number) {
    super(`Circuit open for ${host}; retry after ${retryAfterMs}ms`)
    this.name = "CircuitOpenError"
  }
}
