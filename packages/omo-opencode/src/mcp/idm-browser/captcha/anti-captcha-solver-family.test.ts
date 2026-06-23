import { afterEach, describe, expect, test } from "bun:test"
import type { Page } from "playwright-core"
import { buildAntiCaptchaSolver } from "./anti-captcha-solver"
import type { AntiCaptchaProxyConfig } from "./anti-captcha-types"
import { createFingerprintFamily } from "../../../automation/fingerprint"

const fakeProxy: AntiCaptchaProxyConfig = {
  proxyType: "http",
  proxyAddress: "127.0.0.1",
  proxyPort: 8080,
}

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function createFakePage(): Page {
  return {
    url: () => "https://example.com/protected",
    evaluate: async (fn: ((arg: unknown) => unknown) | string, arg?: unknown) => {
      const fnSrc = typeof fn === "function" ? fn.toString() : fn
      if (fnSrc.includes("document.querySelector(`[${attr}]`)")) {
        if (arg === "data-sitekey" || arg === undefined) {
          return "test-sitekey"
        }
      }
      if (fnSrc.includes("navigator.userAgent")) {
        return "Mozilla/5.0 page-original-ua"
      }
      return null
    },
    waitForRequest: async () => ({ postData: () => null, url: () => "https://api.hcaptcha.com/getcaptcha/test" }),
  } as unknown as Page
}

describe("buildAntiCaptchaSolver with family", () => {
  test("#given family with chrome 148 UA #when solve invoked #then createTask body uses family.userAgent (NOT page UA)", async () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "macos", locale: "en-US" })
    const expectedUa = family.userAgent

    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ url: String(url), body })
      if (String(url).includes("createTask")) {
        return Response.json({ errorId: 0, taskId: "tid-1" })
      }
      return Response.json({
        errorId: 0,
        status: "ready",
        solution: { gRecaptchaResponse: "tok" },
      })
    }

    const solver = buildAntiCaptchaSolver({ apiKey: "k", family, proxy: fakeProxy, pollIntervalMs: 1, timeoutMs: 5000 })
    const page = createFakePage()
    await solver(page, { kind: "hcaptcha_checkbox", confidence: 0.9 })

    const create = requests.find((r) => r.url.includes("createTask"))
    expect(create).toBeDefined()
    const taskBody = (create!.body as { task: { userAgent: string } }).task
    expect(taskBody.userAgent).toBe(expectedUa)
    expect(taskBody.userAgent).not.toBe("Mozilla/5.0 page-original-ua")
  })

  test("#given no family #when solve invoked #then createTask uses extraction userAgent (page-derived)", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      requests.push({ url: String(url), body })
      if (String(url).includes("createTask")) {
        return Response.json({ errorId: 0, taskId: "tid-1" })
      }
      return Response.json({
        errorId: 0,
        status: "ready",
        solution: { gRecaptchaResponse: "tok" },
      })
    }

    const solver = buildAntiCaptchaSolver({ apiKey: "k", proxy: fakeProxy, pollIntervalMs: 1, timeoutMs: 5000 })
    const page = createFakePage()
    await solver(page, { kind: "hcaptcha_checkbox", confidence: 0.9 })

    const create = requests.find((r) => r.url.includes("createTask"))!
    const taskBody = (create.body as { task: { userAgent: string } }).task
    expect(taskBody.userAgent).toBe("Mozilla/5.0 page-original-ua")
  })
})
