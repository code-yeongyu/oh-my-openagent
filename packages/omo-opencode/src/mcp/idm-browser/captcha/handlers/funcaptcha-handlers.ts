import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"
import { dispatchInput } from "./dom-helpers"

async function extractFunCaptcha(page: Page): Promise<CapsolverExtraction | null> {
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
    const scriptPkey = Array.from(document.querySelectorAll("script[src*='arkoselabs']"))
      .map((s) => (s as HTMLScriptElement).src.match(/[?&](?:pkey|public_key)=([^&]+)/)?.[1])
      .find(Boolean)
    return scriptPkey ?? null
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

async function injectFunCaptcha(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const token = solution.token ?? solution.gRecaptchaResponse
  if (!token) return false
  return dispatchInput(page, "input[name='fc-token']", token)
    || dispatchInput(page, "input[name='funcaptcha-token']", token)
}

export const arkoseFuncaptchaHandler: CapsolverTaskHandler = {
  taskType: "FunCaptchaTask",
  extract: extractFunCaptcha,
  inject: injectFunCaptcha,
}
