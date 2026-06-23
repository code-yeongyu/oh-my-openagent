import type { Page } from "playwright-core"
import type { AntiCaptchaTaskHandler, AntiCaptchaExtraction } from "../anti-captcha-registry-types"
import type { AntiCaptchaSolution } from "../anti-captcha-types"
import { dispatchInput } from "./dom-helpers"

async function extractFunCaptcha(page: Page): Promise<AntiCaptchaExtraction | null> {
  const websiteKey = await page.evaluate(() => {
    const arkoseIframe = document.querySelector(
      "iframe[src*='arkoselabs.com'], iframe[src*='funcaptcha.com'], iframe[src*='client-api.arkoselabs.com']",
    ) as HTMLIFrameElement | null
    if (arkoseIframe) {
      try {
        const u = new URL(arkoseIframe.src, location.href)
        const pkey = u.searchParams.get("pkey") ?? u.searchParams.get("public_key")
        if (pkey) return pkey
      } catch {
        void 0
      }
    }
    return null
  })
  if (!websiteKey) return null

  const data = await page.evaluate(() => {
    const w = window as unknown as { ArkoseEnforcement?: { config?: unknown } }
    if (!w.ArkoseEnforcement?.config) return undefined
    try {
      return JSON.stringify(w.ArkoseEnforcement.config)
    } catch {
      return undefined
    }
  })

  return { websiteKey, ...(data ? { data } : {}) }
}

async function injectFunCaptcha(page: Page, solution: AntiCaptchaSolution): Promise<boolean> {
  const token = solution.token ?? solution.gRecaptchaResponse
  if (!token) return false
  return (await dispatchInput(page, "input[name='fc-token']", token))
    || (await dispatchInput(page, "input[name='funcaptcha-token']", token))
}

export const antiCaptchaArkoseFunCaptchaHandler: AntiCaptchaTaskHandler = {
  taskType: "FunCaptchaTask",
  extract: extractFunCaptcha,
  inject: injectFunCaptcha,
}
