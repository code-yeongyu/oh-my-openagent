import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"

async function extractDatadome(page: Page): Promise<CapsolverExtraction | null> {
  const captchaUrl = await page.evaluate(() => {
    const iframe = document.querySelector("iframe[src*='captcha-delivery.com']") as HTMLIFrameElement | null
    return iframe?.src ?? null
  })
  if (!captchaUrl) return null

  const userAgent = await page.evaluate(() => navigator.userAgent)
  return {
    taskExtra: {
      captchaUrl,
      userAgent,
      proxyless: true,
    },
  }
}

async function injectDatadome(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const cookies = solution.cookies
  if (!cookies || cookies.length === 0) return false
  for (const c of cookies) {
    await page.context().addCookies([{
      name: c.name,
      value: c.value,
      domain: c.domain ?? new URL(page.url()).hostname,
      path: c.path ?? "/",
      ...(c.expires ? { expires: c.expires } : {}),
      ...(c.secure !== undefined ? { secure: c.secure } : {}),
      ...(c.httpOnly !== undefined ? { httpOnly: c.httpOnly } : {}),
    }])
  }
  return true
}

export const datadomeHandler: CapsolverTaskHandler = {
  taskType: "DatadomeSliderTask",
  extract: extractDatadome,
  inject: injectDatadome,
}

export const datadomeSliderHandler: CapsolverTaskHandler = {
  taskType: "DatadomeSliderTask",
  extract: extractDatadome,
  inject: injectDatadome,
}
