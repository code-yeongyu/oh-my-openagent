import type { Page } from "playwright-core"
import type { AntiCaptchaTaskHandler, AntiCaptchaExtraction } from "../anti-captcha-registry-types"
import type { AntiCaptchaSolution } from "../anti-captcha-types"
import { readSiteKey, readSiteKeyFromIframe, injectIntoTextarea } from "./dom-helpers"
import { extractHCaptchaRqdata } from "./hcaptcha-rqdata"

async function extractHCaptcha(page: Page): Promise<AntiCaptchaExtraction | null> {
  const fromAttr = await readSiteKey(page, "data-sitekey")
  if (fromAttr) return withEnterpriseContext(page, fromAttr)
  const fromIframe = await readSiteKeyFromIframe(page, "hcaptcha.com", "sitekey")
  if (fromIframe) return withEnterpriseContext(page, fromIframe)
  return null
}

async function withEnterpriseContext(page: Page, websiteKey: string): Promise<AntiCaptchaExtraction> {
  const [rqdata, userAgent] = await Promise.all([
    extractHCaptchaRqdata(page),
    page.evaluate(() => navigator.userAgent).catch(() => null),
  ])
  return {
    websiteKey,
    ...(rqdata ? { enterprisePayload: { rqdata } } : {}),
    ...(userAgent ? { userAgent } : {}),
  }
}

async function injectHCaptcha(page: Page, solution: AntiCaptchaSolution): Promise<boolean> {
  const token = solution.gRecaptchaResponse ?? solution.token
  if (!token) return false
  const ok = await injectIntoTextarea(page, "h-captcha-response", token)
  if (!ok) return false
  await page.evaluate(() => {
    const w = window as unknown as { hcaptcha?: { execute?: () => void } }
    if (w.hcaptcha?.execute) {
      try { w.hcaptcha.execute() } catch { void 0 }
    }
  })
  return true
}

export const antiCaptchaHCaptchaCheckboxHandler: AntiCaptchaTaskHandler = {
  taskType: "HCaptchaTask",
  extract: extractHCaptcha,
  inject: injectHCaptcha,
}

export const antiCaptchaHCaptchaImageGridHandler: AntiCaptchaTaskHandler = {
  taskType: "HCaptchaTask",
  extract: extractHCaptcha,
  inject: injectHCaptcha,
}

export const antiCaptchaHCaptchaTurboHandler: AntiCaptchaTaskHandler = {
  taskType: "HCaptchaTask",
  extract: extractHCaptcha,
  inject: injectHCaptcha,
}

export const antiCaptchaHCaptchaEnterpriseHandler: AntiCaptchaTaskHandler = {
  taskType: "HCaptchaEnterpriseTask",
  extract: extractHCaptcha,
  inject: injectHCaptcha,
}
