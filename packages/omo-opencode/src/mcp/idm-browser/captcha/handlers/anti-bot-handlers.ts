import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"

async function extractCookieFlow(page: Page): Promise<CapsolverExtraction | null> {
  const url = page.url()
  const userAgent = await page.evaluate(() => navigator.userAgent)
  return { taskExtra: { url, userAgent } }
}

async function injectCookies(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const cookies = solution.cookies
  if (!cookies || cookies.length === 0) {
    const headers = solution.headers
    if (!headers) return false
    await page.setExtraHTTPHeaders(headers)
    return true
  }
  for (const c of cookies) {
    await page.context().addCookies([{
      name: c.name,
      value: c.value,
      domain: c.domain ?? new URL(page.url()).hostname,
      path: c.path ?? "/",
      ...(c.expires ? { expires: c.expires } : {}),
    }])
  }
  return true
}

export const kasadaHandler: CapsolverTaskHandler = {
  taskType: "AntiKasadaTask",
  extract: extractCookieFlow,
  inject: injectCookies,
}

export const akamaiBmpHandler: CapsolverTaskHandler = {
  taskType: "AntiAkamaiBMPTask",
  extract: extractCookieFlow,
  inject: injectCookies,
}

export const akamaiWebHandler: CapsolverTaskHandler = {
  taskType: "AntiAkamaiWebTask",
  extract: extractCookieFlow,
  inject: injectCookies,
}

export const impervaHandler: CapsolverTaskHandler = {
  taskType: "AntiImpervaTask",
  extract: extractCookieFlow,
  inject: injectCookies,
}
