import type { Page } from "playwright-core"

export async function readSiteKey(page: Page, attribute = "data-sitekey"): Promise<string | null> {
  return page.evaluate((attr) => {
    const el = document.querySelector(`[${attr}]`) as HTMLElement | null
    return el ? el.getAttribute(attr) : null
  }, attribute)
}

export async function readSiteKeyFromIframe(page: Page, iframePattern: string, queryParam: string): Promise<string | null> {
  return page.evaluate(({ pattern, key }) => {
    const iframe = document.querySelector(`iframe[src*='${pattern}']`) as HTMLIFrameElement | null
    if (!iframe) return null
    const attrSitekey = iframe.getAttribute("data-sitekey")
    try {
      const u = new URL(iframe.src, location.href)
      return new URLSearchParams(u.hash.slice(1)).get(key) ?? u.searchParams.get(key) ?? attrSitekey
    } catch {
      return attrSitekey
    }
  }, { pattern: iframePattern, key: queryParam })
}

export async function injectIntoTextarea(page: Page, name: string, token: string): Promise<boolean> {
  return page.evaluate(({ n, t }) => {
    const ta = document.querySelector(`textarea[name='${n}']`) as HTMLTextAreaElement | null
    if (!ta) return false
    const proto = Object.getPrototypeOf(ta)
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    setter?.call(ta, t)
    ta.dispatchEvent(new Event("input", { bubbles: true }))
    ta.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }, { n: name, t: token })
}

export async function dispatchInput(page: Page, selector: string, value: string): Promise<boolean> {
  return page.evaluate(({ sel, val }) => {
    const input = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null
    if (!input) return false
    const proto = Object.getPrototypeOf(input)
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
    setter?.call(input, val)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }, { sel: selector, val: value })
}

export async function readInvisibleEnterpriseSiteKey(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll("iframe[src*='/recaptcha/enterprise/anchor']")) as HTMLIFrameElement[]
    for (const iframe of iframes) {
      if (!iframe.src.includes("size=invisible")) continue
      try {
        const u = new URL(iframe.src, location.href)
        const key = u.searchParams.get("k") ?? new URLSearchParams(u.hash.slice(1)).get("k")
        if (key) return key
      } catch { continue }
    }
    return null
  })
}

export async function monkeyPatchEnterpriseExecute(page: Page, token: string): Promise<boolean> {
  return page.evaluate((t) => {
    return new Promise<boolean>((resolve) => {
      const tryPatch = (): boolean => {
        const ent = (window as unknown as { grecaptcha?: { enterprise?: { execute?: unknown } } }).grecaptcha?.enterprise
        if (ent && typeof ent.execute === "function") {
          ent.execute = (() => Promise.resolve(t)) as typeof ent.execute
          return true
        }
        return false
      }
      if (tryPatch()) { resolve(true); return }
      const interval = setInterval(() => {
        if (tryPatch()) { clearInterval(interval); resolve(true) }
      }, 200)
      setTimeout(() => { clearInterval(interval); resolve(false) }, 10_000)
    })
  }, token)
}

export async function callWindowCallback(page: Page, callbackName: string, value: string): Promise<boolean> {
  return page.evaluate(({ name, val }) => {
    const fn = (window as unknown as Record<string, unknown>)[name]
    if (typeof fn === "function") {
      try {
        ;(fn as (token: string) => void)(val)
        return true
      } catch {
        return false
      }
    }
    return false
  }, { name: callbackName, val: value })
}
