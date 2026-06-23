import type { ChallengeKind } from "../types"
import type { CapsolverTaskHandler } from "./registry-types"
import {
  hCaptchaCheckboxHandler,
  hCaptchaImageGridHandler,
  hCaptchaTurboHandler,
  hCaptchaEnterpriseHandler,
} from "./handlers/hcaptcha-handlers"
import {
  recaptchaV2CheckboxHandler,
  recaptchaV2ImageHandler,
  recaptchaV3InvisibleHandler,
  recaptchaV3ExecutableHandler,
  recaptchaEnterpriseHandler,
  recaptchaV3EnterpriseInvisibleHandler,
} from "./handlers/recaptcha-handlers"
import { cloudflareTurnstileHandler, cloudflareInterstitialHandler } from "./handlers/cloudflare-handlers"
import { arkoseFuncaptchaHandler } from "./handlers/funcaptcha-handlers"
import { awsWafHandler } from "./handlers/aws-waf-handlers"
import { datadomeHandler, datadomeSliderHandler } from "./handlers/datadome-handlers"
import { geetestV3Handler, geetestV4Handler } from "./handlers/geetest-handlers"
import { mtCaptchaHandler } from "./handlers/mtcaptcha-handlers"
import { kasadaHandler, akamaiBmpHandler, akamaiWebHandler, impervaHandler } from "./handlers/anti-bot-handlers"
import { binanceHandler, duolingoHandler, friendlyCaptchaHandler, cyberSiAraHandler } from "./handlers/niche-handlers"
import { imageTextOcrHandler } from "./handlers/image-text-handlers"
import { multiLayeredFirebaseHandler } from "./handlers/multi-layered-handler"

export const CAPSOLVER_REGISTRY: ReadonlyMap<ChallengeKind, CapsolverTaskHandler> = new Map<ChallengeKind, CapsolverTaskHandler>([
  ["hcaptcha_checkbox", hCaptchaCheckboxHandler],
  ["hcaptcha_image_grid", hCaptchaImageGridHandler],
  ["hcaptcha_turbo", hCaptchaTurboHandler],
  ["hcaptcha_enterprise", hCaptchaEnterpriseHandler],
  ["multi_layered_firebase_recaptcha_hcaptcha", multiLayeredFirebaseHandler],
  ["recaptcha_v2_checkbox", recaptchaV2CheckboxHandler],
  ["recaptcha_v2_image", recaptchaV2ImageHandler],
  ["recaptcha_v3_invisible", recaptchaV3InvisibleHandler],
  ["recaptcha_v3_executable", recaptchaV3ExecutableHandler],
  ["recaptcha_enterprise", recaptchaEnterpriseHandler],
  ["recaptcha_enterprise_invisible", recaptchaV3EnterpriseInvisibleHandler],
  ["cloudflare_turnstile", cloudflareTurnstileHandler],
  ["cloudflare_interstitial", cloudflareInterstitialHandler],
  ["arkose_funcaptcha", arkoseFuncaptchaHandler],
  ["aws_waf", awsWafHandler],
  ["datadome", datadomeHandler],
  ["datadome_slider", datadomeSliderHandler],
  ["geetest_v3", geetestV3Handler],
  ["geetest_v4", geetestV4Handler],
  ["mtcaptcha", mtCaptchaHandler],
  ["kasada", kasadaHandler],
  ["akamai_bmp", akamaiBmpHandler],
  ["akamai_web", akamaiWebHandler],
  ["imperva", impervaHandler],
  ["binance_captcha", binanceHandler],
  ["duolingo", duolingoHandler],
  ["friendly_captcha", friendlyCaptchaHandler],
  ["cybersiara", cyberSiAraHandler],
  ["image_text_ocr", imageTextOcrHandler],
])

export function getCapsolverHandler(kind: ChallengeKind): CapsolverTaskHandler | undefined {
  return CAPSOLVER_REGISTRY.get(kind)
}
