import { describe, expect, test } from "bun:test"
import type { Page } from "playwright-core"
import { ANTI_CAPTCHA_REGISTRY, getAntiCaptchaHandler } from "./anti-captcha-registry"

describe("ANTI_CAPTCHA_REGISTRY", () => {
  test("#given hCaptcha kinds #when looked up #then returns handlers with proper task types", () => {
    expect(getAntiCaptchaHandler("hcaptcha_checkbox")?.taskType).toBe("HCaptchaTask")
    expect(getAntiCaptchaHandler("hcaptcha_image_grid")?.taskType).toBe("HCaptchaTask")
    expect(getAntiCaptchaHandler("hcaptcha_turbo")?.taskType).toBe("HCaptchaTask")
    expect(getAntiCaptchaHandler("hcaptcha_enterprise")?.taskType).toBe("HCaptchaEnterpriseTask")
  })

  test("#given recaptcha kinds #when looked up #then returns handlers with v2/v3 task types", () => {
    expect(getAntiCaptchaHandler("recaptcha_v2_checkbox")?.taskType).toBe("RecaptchaV2Task")
    expect(getAntiCaptchaHandler("recaptcha_v2_image")?.taskType).toBe("RecaptchaV2Task")
    expect(getAntiCaptchaHandler("recaptcha_v3_invisible")?.taskType).toBe("RecaptchaV3Task")
    expect(getAntiCaptchaHandler("recaptcha_v3_executable")?.taskType).toBe("RecaptchaV3Task")
    expect(getAntiCaptchaHandler("recaptcha_enterprise")?.taskType).toBe("RecaptchaV2EnterpriseTask")
  })

  test("#given turnstile kinds #when looked up #then returns TurnstileTask", () => {
    expect(getAntiCaptchaHandler("cloudflare_turnstile")?.taskType).toBe("TurnstileTask")
    expect(getAntiCaptchaHandler("cloudflare_interstitial")?.taskType).toBe("TurnstileTask")
  })

  test("#given arkose_funcaptcha #when looked up #then returns FunCaptchaTask", () => {
    expect(getAntiCaptchaHandler("arkose_funcaptcha")?.taskType).toBe("FunCaptchaTask")
  })

  test("#given geetest kinds #when looked up #then returns GeeTestTask", () => {
    expect(getAntiCaptchaHandler("geetest_v3")?.taskType).toBe("GeeTestTask")
    expect(getAntiCaptchaHandler("geetest_v4")?.taskType).toBe("GeeTestTask")
  })

  test("#given friendly_captcha #when looked up #then returns AntiBotCookieTask", () => {
    expect(getAntiCaptchaHandler("friendly_captcha")?.taskType).toBe("AntiBotCookieTask")
  })

  test("#given vision-only kinds #when looked up #then returns undefined", () => {
    expect(getAntiCaptchaHandler("emoji_puzzle")).toBeUndefined()
    expect(getAntiCaptchaHandler("image_grid_puzzle")).toBeUndefined()
    expect(getAntiCaptchaHandler("datadome")).toBeUndefined()
    expect(getAntiCaptchaHandler("mtcaptcha")).toBeUndefined()
    expect(getAntiCaptchaHandler("aws_waf")).toBeUndefined()
  })

  test("#given hCaptcha handler with sitekey + rqdata + UA #when extract called #then returns enterprisePayload + userAgent", async () => {
    const handler = getAntiCaptchaHandler("hcaptcha_enterprise")!
    const page = createFakePage({
      sitekey: "3aad1500-7e79-4051-aac5-6852324dab76",
      rqdata: "rqdata-value",
      userAgent: "Mozilla/5.0 chrome-148",
    })

    const extraction = await handler.extract(page)

    expect(extraction).toEqual({
      websiteKey: "3aad1500-7e79-4051-aac5-6852324dab76",
      enterprisePayload: { rqdata: "rqdata-value" },
      userAgent: "Mozilla/5.0 chrome-148",
    })
  })

  test("#given recaptcha handler #when extract called with sitekey #then returns websiteKey", async () => {
    const handler = getAntiCaptchaHandler("recaptcha_v2_checkbox")!
    const page = createFakePage({ sitekey: "6Le-recaptcha-key" })

    const extraction = await handler.extract(page)

    expect(extraction).toEqual({ websiteKey: "6Le-recaptcha-key" })
  })

  test("#given registry size #when counted #then 15 supported kinds", () => {
    expect(ANTI_CAPTCHA_REGISTRY.size).toBe(15)
  })
})

type FakePageOpts = {
  sitekey?: string
  rqdata?: string
  userAgent?: string
}

function createFakePage(opts: FakePageOpts): Page {
  return {
    url: () => "https://example.com/protected",
    evaluate: async (fn: ((arg: unknown) => unknown) | string, arg?: unknown) => {
      const fnSrc = typeof fn === "function" ? fn.toString() : fn
      if (fnSrc.includes("document.querySelector(`[${attr}]`)") && opts.sitekey) {
        const argString = typeof arg === "string" ? arg : ""
        if (argString === "data-sitekey" || arg === undefined) {
          return opts.sitekey
        }
      }
      if (fnSrc.includes("navigator.userAgent")) {
        return opts.userAgent ?? null
      }
      return null
    },
    waitForRequest: async () => ({
      postData: () => opts.rqdata ? `rqdata=${encodeURIComponent(opts.rqdata)}` : null,
      url: () => "https://api.hcaptcha.com/getcaptcha/3aad1500-7e79-4051-aac5-6852324dab76",
    }),
  } as unknown as Page
}
