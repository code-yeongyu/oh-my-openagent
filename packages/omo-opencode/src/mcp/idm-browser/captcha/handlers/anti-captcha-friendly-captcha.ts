import type { Page } from "playwright-core"
import type { AntiCaptchaTaskHandler, AntiCaptchaExtraction } from "../anti-captcha-registry-types"
import type { AntiCaptchaSolution } from "../anti-captcha-types"
import { dispatchInput, readSiteKey } from "./dom-helpers"

async function extractFriendly(page: Page): Promise<AntiCaptchaExtraction | null> {
  const sk = await readSiteKey(page, "data-sitekey")
  if (sk) return { websiteKey: sk }
  return null
}

async function injectFriendly(page: Page, solution: AntiCaptchaSolution): Promise<boolean> {
  const token = solution.token ?? solution.gRecaptchaResponse
  if (!token) return false
  return dispatchInput(page, "input[name='frc-captcha-solution']", token)
}

export const antiCaptchaFriendlyHandler: AntiCaptchaTaskHandler = {
  taskType: "AntiBotCookieTask",
  extract: extractFriendly,
  inject: injectFriendly,
}
