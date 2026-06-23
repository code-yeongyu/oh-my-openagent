import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"
import { callWindowCallback } from "./dom-helpers"

async function extractGeetestV3(page: Page): Promise<CapsolverExtraction | null> {
  const cfg = await page.evaluate(() => {
    const w = window as unknown as { initGeetestPayload?: { gt?: string; challenge?: string; geetestApiServerSubdomain?: string } }
    return w.initGeetestPayload ?? null
  })
  if (!cfg?.gt || !cfg.challenge) return null
  return {
    geetest: {
      gt: cfg.gt,
      challenge: cfg.challenge,
      ...(cfg.geetestApiServerSubdomain ? { geetestApiServerSubdomain: cfg.geetestApiServerSubdomain } : {}),
    },
  }
}

async function extractGeetestV4(page: Page): Promise<CapsolverExtraction | null> {
  const captchaId = await page.evaluate(() => {
    const w = window as unknown as { geetestV4?: { captchaId?: string } }
    return w.geetestV4?.captchaId ?? null
  })
  if (!captchaId) return null
  return { taskExtra: { captchaId } }
}

async function injectGeetestV3(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const challenge = solution.challenge
  const validate = solution.validate
  const seccode = solution.seccode
  if (!challenge || !validate || !seccode) return false
  return page.evaluate(({ ch, va, sc }) => {
    const w = window as unknown as { geetestCallback?: (data: Record<string, string>) => void }
    if (typeof w.geetestCallback === "function") {
      w.geetestCallback({ geetest_challenge: ch, geetest_validate: va, geetest_seccode: sc })
      return true
    }
    return false
  }, { ch: challenge, va: validate, sc: seccode })
}

async function injectGeetestV4(page: Page, solution: CapsolverSolution): Promise<boolean> {
  if (!solution.captcha_id || !solution.captcha_output) return false
  return callWindowCallback(page, "geetestV4Callback", solution.captcha_output)
}

export const geetestV3Handler: CapsolverTaskHandler = {
  taskType: "GeeTestTask",
  extract: extractGeetestV3,
  inject: injectGeetestV3,
}

export const geetestV4Handler: CapsolverTaskHandler = {
  taskType: "GeeTestV4Task",
  extract: extractGeetestV4,
  inject: injectGeetestV4,
}
