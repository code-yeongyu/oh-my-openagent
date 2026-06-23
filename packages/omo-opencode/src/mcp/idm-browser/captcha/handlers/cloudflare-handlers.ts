import type { Page } from "playwright-core"
import type { CapsolverTaskHandler, CapsolverExtraction, CapsolverSolution } from "../registry-types"
import type { CapsolverTurnstileMetadata } from "../capsolver-client"
import { dispatchInput, callWindowCallback } from "./dom-helpers"

async function extractTurnstileSitekey(page: Page): Promise<string | null> {
  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const candidate = await page.evaluate(() => {
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
          const keys = ["k", "sitekey"]
          const fromQuery = keys.map((key) => fragment.get(key) ?? u.searchParams.get(key)).find(Boolean)
          if (fromQuery) return fromQuery
          const parts = u.pathname.split("/").filter(Boolean)
          for (const part of parts) {
            if (/^0x[A-Za-z0-9]{8,}$/.test(part)) return part
            if (/^[A-Za-z0-9_-]{20,}$/.test(part)) return part
          }
        } catch {
          void 0
        }
      }
      const opt = (window as unknown as { _cf_chl_opt?: { chlApiSitekey?: string } })._cf_chl_opt
      return opt?.chlApiSitekey ?? null
    })
    if (candidate) return candidate
    await page.waitForTimeout(500)
  }
  return null
}

async function extractTurnstileMetadata(page: Page): Promise<CapsolverTurnstileMetadata | undefined> {
  const data = await page.evaluate(() => {
    const div = document.querySelector(".cf-turnstile, [data-sitekey]") as HTMLElement | null
    if (!div) return null
    return {
      action: div.getAttribute("data-action") ?? undefined,
      cdata: div.getAttribute("data-cdata") ?? undefined,
    }
  })
  if (!data) return undefined
  if (!data.action && !data.cdata) return undefined
  return data
}

async function extractTurnstile(page: Page): Promise<CapsolverExtraction | null> {
  const websiteKey = await extractTurnstileSitekey(page)
  if (!websiteKey) return null
  const metadata = await extractTurnstileMetadata(page)
  return { websiteKey, metadata }
}

async function injectTurnstile(page: Page, solution: CapsolverSolution): Promise<boolean> {
  const token = solution.token ?? solution.gRecaptchaResponse
  if (!token) return false
  const dispatched = await dispatchInput(page, 'input[name="cf-turnstile-response"]', token)
    || await dispatchInput(page, 'textarea[name="cf-turnstile-response"]', token)

  const callbackName = await page.evaluate(() => {
    const div = document.querySelector(".cf-turnstile, [data-sitekey]") as HTMLElement | null
    return div?.getAttribute("data-callback") ?? null
  })
  if (callbackName) {
    await callWindowCallback(page, callbackName, token).catch(() => false)
  }

  await page.evaluate(() => {
    const ts = (window as unknown as { turnstile?: { execute?: () => void } }).turnstile
    if (ts?.execute) {
      try { ts.execute() } catch { void 0 }
    }
  })

  return dispatched
}

export const cloudflareTurnstileHandler: CapsolverTaskHandler = {
  taskType: "AntiTurnstileTaskProxyless",
  extract: extractTurnstile,
  inject: injectTurnstile,
}

export const cloudflareInterstitialHandler: CapsolverTaskHandler = {
  taskType: "AntiTurnstileTaskProxyless",
  extract: extractTurnstile,
  inject: injectTurnstile,
}
