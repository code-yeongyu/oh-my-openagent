import type { Page } from "playwright-core"
import type { AntiCaptchaTaskHandler, AntiCaptchaExtraction } from "../anti-captcha-registry-types"
import type { AntiCaptchaSolution } from "../anti-captcha-types"
import { dispatchInput, callWindowCallback } from "./dom-helpers"

async function extractTurnstileSitekey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const div = document.querySelector(".cf-turnstile, [data-sitekey]") as HTMLElement | null
    if (div) {
      const sk = div.getAttribute("data-sitekey")
      if (sk && sk.length > 4) return sk
    }
    const iframe = document.querySelector("iframe[src*='challenges.cloudflare.com']") as HTMLIFrameElement | null
    if (iframe) {
      try {
        const u = new URL(iframe.src, location.href)
        const fragment = new URLSearchParams(u.hash.slice(1))
        const fromQuery = (["k", "sitekey"]).map((key) => fragment.get(key) ?? u.searchParams.get(key)).find(Boolean)
        if (fromQuery) return fromQuery
      } catch {
        void 0
      }
    }
    const opt = (window as unknown as { _cf_chl_opt?: { chlApiSitekey?: string } })._cf_chl_opt
    return opt?.chlApiSitekey ?? null
  })
}

async function extractTurnstile(page: Page): Promise<AntiCaptchaExtraction | null> {
  const websiteKey = await extractTurnstileSitekey(page)
  if (!websiteKey) return null
  const pageAction = await page.evaluate(() => {
    const div = document.querySelector(".cf-turnstile, [data-sitekey]") as HTMLElement | null
    return div?.getAttribute("data-action") ?? null
  })
  return { websiteKey, ...(pageAction ? { pageAction } : {}) }
}

async function injectTurnstile(page: Page, solution: AntiCaptchaSolution): Promise<boolean> {
  const token = solution.token ?? solution.gRecaptchaResponse
  if (!token) return false
  const dispatched = (await dispatchInput(page, "input[name='cf-turnstile-response']", token))
    || (await dispatchInput(page, "textarea[name='cf-turnstile-response']", token))
  const callbackName = await page.evaluate(() => {
    const div = document.querySelector(".cf-turnstile, [data-sitekey]") as HTMLElement | null
    return div?.getAttribute("data-callback") ?? null
  })
  if (callbackName) {
    await callWindowCallback(page, callbackName, token).catch(() => false)
  }
  return dispatched
}

export const antiCaptchaTurnstileHandler: AntiCaptchaTaskHandler = {
  taskType: "TurnstileTask",
  extract: extractTurnstile,
  inject: injectTurnstile,
}

export const antiCaptchaCloudflareInterstitialHandler: AntiCaptchaTaskHandler = {
  taskType: "TurnstileTask",
  extract: extractTurnstile,
  inject: injectTurnstile,
}
