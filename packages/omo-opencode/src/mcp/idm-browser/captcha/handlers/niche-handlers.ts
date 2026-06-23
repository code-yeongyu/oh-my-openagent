import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"
import { dispatchInput, callWindowCallback, readSiteKey } from "./dom-helpers"

async function extractFromSitekey(page: Page): Promise<CapsolverExtraction | null> {
  const sk = await readSiteKey(page, "data-sitekey")
  if (sk) return { websiteKey: sk }
  return null
}

async function injectGenericToken(page: Page, solution: CapsolverSolution, name: string): Promise<boolean> {
  const token = solution.token ?? solution.gRecaptchaResponse
  if (!token) return false
  const ok = await dispatchInput(page, `input[name='${name}']`, token)
  if (ok) return true
  return callWindowCallback(page, `${name}Callback`, token)
}

export const binanceHandler: CapsolverTaskHandler = {
  taskType: "BinanceCaptchaTask",
  extract: extractFromSitekey,
  inject: (page, solution) => injectGenericToken(page, solution, "binance-captcha-response"),
}

export const duolingoHandler: CapsolverTaskHandler = {
  taskType: "DuoLingoTask",
  extract: extractFromSitekey,
  inject: (page, solution) => injectGenericToken(page, solution, "duolingo-captcha-response"),
}

export const friendlyCaptchaHandler: CapsolverTaskHandler = {
  taskType: "FriendlyCaptchaTask",
  extract: async (page) => {
    const sk = await readSiteKey(page, "data-sitekey")
    if (sk) return { websiteKey: sk }
    return null
  },
  inject: (page, solution) => injectGenericToken(page, solution, "frc-captcha-solution"),
}

export const cyberSiAraHandler: CapsolverTaskHandler = {
  taskType: "CyberSiAraTask",
  extract: extractFromSitekey,
  inject: (page, solution) => injectGenericToken(page, solution, "cybersiara-token"),
}
