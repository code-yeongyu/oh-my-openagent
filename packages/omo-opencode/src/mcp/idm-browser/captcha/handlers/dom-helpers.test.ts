import { describe, expect, test } from "bun:test"
import type { Page } from "playwright-core"
import { readSiteKey, readSiteKeyFromIframe } from "./dom-helpers"

describe("dom captcha sitekey helpers", () => {
  test("#given legacy widget attribute #when readSiteKey runs #then returns data-sitekey", async () => {
    const page = createSitekeyPage({ widgetSitekey: "legacy-widget-key" })

    const sitekey = await readSiteKey(page, "data-sitekey")

    expect(sitekey).toBe("legacy-widget-key")
  })

  test("#given hCaptcha iframe fragment #when readSiteKeyFromIframe runs #then returns fragment sitekey first", async () => {
    const page = createSitekeyPage({
      iframeSrc: "https://newassets.hcaptcha.com/captcha/static/hcaptcha.html#frame=challenge&sitekey=fragment-key",
    })

    const sitekey = await readSiteKeyFromIframe(page, "hcaptcha.com", "sitekey")

    expect(sitekey).toBe("fragment-key")
  })

  test("#given hCaptcha iframe query #when readSiteKeyFromIframe runs #then returns query sitekey", async () => {
    const page = createSitekeyPage({ iframeSrc: "https://js.hcaptcha.com/1/api.html?sitekey=query-key" })

    const sitekey = await readSiteKeyFromIframe(page, "hcaptcha.com", "sitekey")

    expect(sitekey).toBe("query-key")
  })

  test("#given iframe data-sitekey #when readSiteKeyFromIframe runs #then returns iframe attribute fallback", async () => {
    const page = createSitekeyPage({ iframeSrc: "https://js.hcaptcha.com/1/api.html", iframeSitekey: "iframe-attr-key" })

    const sitekey = await readSiteKeyFromIframe(page, "hcaptcha.com", "sitekey")

    expect(sitekey).toBe("iframe-attr-key")
  })
})

type SitekeyPageOptions = {
  iframeSitekey?: string
  iframeSrc?: string
  widgetSitekey?: string
}

function createSitekeyPage(opts: SitekeyPageOptions): Page {
  return {
    evaluate: async (fn: ((arg: unknown) => unknown) | string, arg?: unknown) => {
      if (typeof fn !== "function") return null
      const originalDocument = globalThis.document
      const originalLocation = globalThis.location
      Object.defineProperty(globalThis, "location", { configurable: true, value: { href: "https://example.com" } })
      Object.defineProperty(globalThis, "document", { configurable: true, value: createDocumentStub(opts) })
      try {
        return fn(arg)
      } finally {
        Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument })
        Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation })
      }
    },
  } as unknown as Page
}

function createDocumentStub(opts: SitekeyPageOptions): Pick<Document, "querySelector"> {
  return {
    querySelector: (selector: string) => {
      if (selector === "[data-sitekey]" && opts.widgetSitekey) return createElementStub({ "data-sitekey": opts.widgetSitekey })
      if (selector.includes("iframe") && opts.iframeSrc) {
        return { ...createElementStub({ "data-sitekey": opts.iframeSitekey ?? null }), src: opts.iframeSrc }
      }
      return null
    },
  }
}

function createElementStub(attrs: Record<string, string | null>): Pick<HTMLElement, "getAttribute"> {
  return { getAttribute: (name: string) => attrs[name] ?? null }
}
