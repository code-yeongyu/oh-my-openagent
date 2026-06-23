import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"
import { dispatchInput } from "./dom-helpers"

async function extractMtCaptcha(page: Page): Promise<CapsolverExtraction | null> {
  const websiteKey = await page.evaluate(() => {
    const w = window as unknown as { mtcaptchaConfig?: { sitekey?: string } }
    return w.mtcaptchaConfig?.sitekey ?? null
  })
  if (!websiteKey) return null
  return { websiteKey }
}

async function injectMtCaptcha(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const token = solution.token ?? solution.gRecaptchaResponse
  if (!token) return false
  return dispatchInput(page, "input[name='mtcaptcha-verifiedtoken']", token)
}

export const mtCaptchaHandler: CapsolverTaskHandler = {
  taskType: "MtCaptchaTask",
  extract: extractMtCaptcha,
  inject: injectMtCaptcha,
}
