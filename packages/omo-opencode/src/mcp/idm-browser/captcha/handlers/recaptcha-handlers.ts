import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"
import {
  readSiteKey,
  readSiteKeyFromIframe,
  readInvisibleEnterpriseSiteKey,
  injectIntoTextarea,
  monkeyPatchEnterpriseExecute,
} from "./dom-helpers"

async function extractRecaptcha(page: Page): Promise<CapsolverExtraction | null> {
  const fromAttr = await readSiteKey(page, "data-sitekey")
  if (fromAttr) return { websiteKey: fromAttr }
  const fromIframe = await readSiteKeyFromIframe(page, "recaptcha", "k")
  if (fromIframe) return { websiteKey: fromIframe }
  return null
}

async function injectRecaptcha(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const token = solution.gRecaptchaResponse ?? solution.token
  if (!token) return false
  return injectIntoTextarea(page, "g-recaptcha-response", token)
}

async function extractInvisibleEnterprise(page: Page): Promise<CapsolverExtraction | null> {
  const sitekey = await readInvisibleEnterpriseSiteKey(page)
  if (!sitekey) return null
  return { websiteKey: sitekey, isInvisible: true }
}

async function injectInvisibleEnterprise(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const token = solution.gRecaptchaResponse ?? solution.token
  if (!token) return false
  await injectIntoTextarea(page, "g-recaptcha-response", token).catch(() => false)
  return monkeyPatchEnterpriseExecute(page, token)
}

export const recaptchaV2CheckboxHandler: CapsolverTaskHandler = {
  taskType: "ReCaptchaV2Task",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}

export const recaptchaV2ImageHandler: CapsolverTaskHandler = {
  taskType: "ReCaptchaV2Task",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}

export const recaptchaV3InvisibleHandler: CapsolverTaskHandler = {
  taskType: "ReCaptchaV3Task",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}

export const recaptchaV3ExecutableHandler: CapsolverTaskHandler = {
  taskType: "ReCaptchaV3Task",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}

export const recaptchaEnterpriseHandler: CapsolverTaskHandler = {
  taskType: "ReCaptchaV2EnterpriseTask",
  extract: extractRecaptcha,
  inject: injectRecaptcha,
}

export const recaptchaV3EnterpriseInvisibleHandler: CapsolverTaskHandler = {
  taskType: "ReCaptchaV3EnterpriseTask",
  extract: extractInvisibleEnterprise,
  inject: injectInvisibleEnterprise,
}
