import type { Page } from "playwright-core"
import type { AntiCaptchaTaskHandler, AntiCaptchaExtraction } from "../anti-captcha-registry-types"
import type { AntiCaptchaSolution } from "../anti-captcha-types"
import { readSiteKey, readSiteKeyFromIframe, injectIntoTextarea } from "./dom-helpers"

async function extractRecaptcha(page: Page): Promise<AntiCaptchaExtraction | null> {
  const fromAttr = await readSiteKey(page, "data-sitekey")
  if (fromAttr) return { websiteKey: fromAttr }
  const fromIframe = await readSiteKeyFromIframe(page, "recaptcha", "k")
  if (fromIframe) return { websiteKey: fromIframe }
  return null
}

async function injectRecaptcha(page: Page, solution: AntiCaptchaSolution): Promise<boolean> {
  const token = solution.gRecaptchaResponse ?? solution.token
  if (!token) return false
  return injectIntoTextarea(page, "g-recaptcha-response", token)
}

export const antiCaptchaRecaptchaV2CheckboxHandler: AntiCaptchaTaskHandler = {
  taskType: "RecaptchaV2Task",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}

export const antiCaptchaRecaptchaV2ImageHandler: AntiCaptchaTaskHandler = {
  taskType: "RecaptchaV2Task",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}

export const antiCaptchaRecaptchaV3InvisibleHandler: AntiCaptchaTaskHandler = {
  taskType: "RecaptchaV3Task",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}

export const antiCaptchaRecaptchaV3ExecutableHandler: AntiCaptchaTaskHandler = {
  taskType: "RecaptchaV3Task",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}

export const antiCaptchaRecaptchaEnterpriseHandler: AntiCaptchaTaskHandler = {
  taskType: "RecaptchaV2EnterpriseTask",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}
