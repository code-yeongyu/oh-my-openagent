import type { ChallengeKind } from "../types"
import type { AntiCaptchaTaskHandler, AntiCaptchaRegistry } from "./anti-captcha-registry-types"
import {
  antiCaptchaHCaptchaCheckboxHandler,
  antiCaptchaHCaptchaImageGridHandler,
  antiCaptchaHCaptchaTurboHandler,
  antiCaptchaHCaptchaEnterpriseHandler,
} from "./handlers/anti-captcha-hcaptcha"
import {
  antiCaptchaRecaptchaV2CheckboxHandler,
  antiCaptchaRecaptchaV2ImageHandler,
  antiCaptchaRecaptchaV3InvisibleHandler,
  antiCaptchaRecaptchaV3ExecutableHandler,
  antiCaptchaRecaptchaEnterpriseHandler,
} from "./handlers/anti-captcha-recaptcha"
import {
  antiCaptchaTurnstileHandler,
  antiCaptchaCloudflareInterstitialHandler,
} from "./handlers/anti-captcha-turnstile"
import { antiCaptchaArkoseFunCaptchaHandler } from "./handlers/anti-captcha-funcaptcha"
import {
  antiCaptchaGeetestV3Handler,
  antiCaptchaGeetestV4Handler,
} from "./handlers/anti-captcha-geetest"
import { antiCaptchaFriendlyHandler } from "./handlers/anti-captcha-friendly-captcha"

export const ANTI_CAPTCHA_REGISTRY: AntiCaptchaRegistry = new Map<ChallengeKind, AntiCaptchaTaskHandler>([
  ["hcaptcha_checkbox", antiCaptchaHCaptchaCheckboxHandler],
  ["hcaptcha_image_grid", antiCaptchaHCaptchaImageGridHandler],
  ["hcaptcha_turbo", antiCaptchaHCaptchaTurboHandler],
  ["hcaptcha_enterprise", antiCaptchaHCaptchaEnterpriseHandler],
  ["recaptcha_v2_checkbox", antiCaptchaRecaptchaV2CheckboxHandler],
  ["recaptcha_v2_image", antiCaptchaRecaptchaV2ImageHandler],
  ["recaptcha_v3_invisible", antiCaptchaRecaptchaV3InvisibleHandler],
  ["recaptcha_v3_executable", antiCaptchaRecaptchaV3ExecutableHandler],
  ["recaptcha_enterprise", antiCaptchaRecaptchaEnterpriseHandler],
  ["cloudflare_turnstile", antiCaptchaTurnstileHandler],
  ["cloudflare_interstitial", antiCaptchaCloudflareInterstitialHandler],
  ["arkose_funcaptcha", antiCaptchaArkoseFunCaptchaHandler],
  ["geetest_v3", antiCaptchaGeetestV3Handler],
  ["geetest_v4", antiCaptchaGeetestV4Handler],
  ["friendly_captcha", antiCaptchaFriendlyHandler],
])

export function getAntiCaptchaHandler(kind: ChallengeKind): AntiCaptchaTaskHandler | undefined {
  return ANTI_CAPTCHA_REGISTRY.get(kind)
}
