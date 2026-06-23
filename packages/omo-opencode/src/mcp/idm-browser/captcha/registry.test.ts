import { describe, test, expect } from "bun:test"
import type { Page } from "playwright-core"
import { CAPSOLVER_REGISTRY, getCapsolverHandler } from "./registry"
import { MULTI_LAYERED_FIREBASE_DIAGNOSTIC } from "./handlers/multi-layered-handler"
import { ChallengeKindSchema, type ChallengeKind } from "../types"
import { SOLVER_PREFERENCE } from "./chain"

describe("CAPSOLVER_REGISTRY", () => {
  test("#given every challenge kind in SOLVER_PREFERENCE #when CapSolver listed first or after vision #then registry has a handler", () => {
    for (const kind of Object.keys(SOLVER_PREFERENCE) as ChallengeKind[]) {
      const order = SOLVER_PREFERENCE[kind]
      const usesCapsolver = order.includes("capsolver")
      if (!usesCapsolver) continue
      if (kind === "emoji_puzzle") continue
      if (kind === "image_grid_puzzle") continue
      const handler = getCapsolverHandler(kind)
      expect(handler).toBeDefined()
    }
  })

  test("#given every kind in ChallengeKindSchema #when SOLVER_PREFERENCE checked #then has at least one preference entry", () => {
    for (const kind of ChallengeKindSchema.options) {
      expect(SOLVER_PREFERENCE[kind].length).toBeGreaterThan(0)
    }
  })

  test("#given hCaptcha image grid handler #when extract called on page with sitekey #then returns the sitekey", async () => {
    const handler = getCapsolverHandler("hcaptcha_image_grid")
    expect(handler).toBeDefined()
    expect(handler!.taskType).toBe("HCaptchaTask")

    const page = createFakePage({
      sitekey: "10000000-ffff-ffff-ffff-000000000001",
    })
    const extraction = await handler!.extract(page)
    expect(extraction).toEqual({ websiteKey: "10000000-ffff-ffff-ffff-000000000001" })
  })

  test("#given hCaptcha handler sees rqdata and user agent #when extract called #then returns enterprise payload and userAgent", async () => {
    const handler = getCapsolverHandler("hcaptcha_enterprise")
    const page = createFakePage({
      sitekey: "10000000-ffff-ffff-ffff-000000000001",
      rqdata: "rqdata-value",
      userAgent: "Mozilla/5.0 test",
    })

    const extraction = await handler!.extract(page)

    expect(extraction).toEqual({
      websiteKey: "10000000-ffff-ffff-ffff-000000000001",
      enterprisePayload: { rqdata: "rqdata-value" },
      userAgent: "Mozilla/5.0 test",
    })
  })

  test("#given hCaptcha turbo handler #when registered #then taskType is HCaptchaTurboTask", () => {
    const handler = getCapsolverHandler("hcaptcha_turbo")
    expect(handler!.taskType).toBe("HCaptchaTurboTask")
  })

  test("#given hCaptcha enterprise handler #when registered #then taskType is HCaptchaEnterpriseTask", () => {
    const handler = getCapsolverHandler("hcaptcha_enterprise")
    expect(handler!.taskType).toBe("HCaptchaEnterpriseTask")
  })

  test("#given recaptcha enterprise handler #when registered #then taskType is ReCaptchaV2EnterpriseTask", () => {
    const handler = getCapsolverHandler("recaptcha_enterprise")
    expect(handler!.taskType).toBe("ReCaptchaV2EnterpriseTask")
  })

  test("#given recaptcha v3 executable handler #when registered #then taskType is ReCaptchaV3Task", () => {
    const handler = getCapsolverHandler("recaptcha_v3_executable")
    expect(handler!.taskType).toBe("ReCaptchaV3Task")
  })

  test("#given cloudflare turnstile handler #when registered #then taskType is AntiTurnstileTaskProxyless", () => {
    const handler = getCapsolverHandler("cloudflare_turnstile")
    expect(handler!.taskType).toBe("AntiTurnstileTaskProxyless")
  })

  test("#given aws_waf handler #when registered #then taskType is AntiAwsWafTask", () => {
    const handler = getCapsolverHandler("aws_waf")
    expect(handler!.taskType).toBe("AntiAwsWafTask")
  })

  test("#given datadome_slider handler #when registered #then taskType is DatadomeSliderTask", () => {
    const handler = getCapsolverHandler("datadome_slider")
    expect(handler!.taskType).toBe("DatadomeSliderTask")
  })

  test("#given geetest_v3 handler #when registered #then taskType is GeeTestTask", () => {
    const handler = getCapsolverHandler("geetest_v3")
    expect(handler!.taskType).toBe("GeeTestTask")
  })

  test("#given geetest_v4 handler #when registered #then taskType is GeeTestV4Task", () => {
    const handler = getCapsolverHandler("geetest_v4")
    expect(handler!.taskType).toBe("GeeTestV4Task")
  })

  test("#given mtcaptcha handler #when registered #then taskType is MtCaptchaTask", () => {
    const handler = getCapsolverHandler("mtcaptcha")
    expect(handler!.taskType).toBe("MtCaptchaTask")
  })

  test("#given kasada handler #when registered #then taskType is AntiKasadaTask", () => {
    expect(getCapsolverHandler("kasada")!.taskType).toBe("AntiKasadaTask")
  })

  test("#given akamai handlers #when registered #then taskTypes match family", () => {
    expect(getCapsolverHandler("akamai_bmp")!.taskType).toBe("AntiAkamaiBMPTask")
    expect(getCapsolverHandler("akamai_web")!.taskType).toBe("AntiAkamaiWebTask")
  })

  test("#given imperva handler #when registered #then taskType is AntiImpervaTask", () => {
    expect(getCapsolverHandler("imperva")!.taskType).toBe("AntiImpervaTask")
  })

  test("#given binance handler #when registered #then taskType is BinanceCaptchaTask", () => {
    expect(getCapsolverHandler("binance_captcha")!.taskType).toBe("BinanceCaptchaTask")
  })

  test("#given duolingo handler #when registered #then taskType is DuoLingoTask", () => {
    expect(getCapsolverHandler("duolingo")!.taskType).toBe("DuoLingoTask")
  })

  test("#given friendly_captcha handler #when registered #then taskType is FriendlyCaptchaTask", () => {
    expect(getCapsolverHandler("friendly_captcha")!.taskType).toBe("FriendlyCaptchaTask")
  })

  test("#given cybersiara handler #when registered #then taskType is CyberSiAraTask", () => {
    expect(getCapsolverHandler("cybersiara")!.taskType).toBe("CyberSiAraTask")
  })

  test("#given image_text_ocr handler #when registered #then taskType is ImageToTextTask", () => {
    expect(getCapsolverHandler("image_text_ocr")!.taskType).toBe("ImageToTextTask")
  })

  test("#given vision-only kinds #when looked up in registry #then no handler", () => {
    expect(getCapsolverHandler("emoji_puzzle")).toBeUndefined()
    expect(getCapsolverHandler("image_grid_puzzle")).toBeUndefined()
  })

  test("#given multi-layered Firebase handler #when extract runs #then logs diagnostic and returns null", async () => {
    const originalError = console.error
    const messages: string[] = []
    console.error = (message?: unknown) => { messages.push(String(message)) }
    try {
      const extraction = await getCapsolverHandler("multi_layered_firebase_recaptcha_hcaptcha")!.extract(createFakePage({}))
      expect(extraction).toBeNull()
      expect(messages.join("\n")).toContain(MULTI_LAYERED_FIREBASE_DIAGNOSTIC)
    } finally {
      console.error = originalError
    }
  })

  test("#given registry size #when counted #then matches expected count of supported kinds", () => {
    expect(CAPSOLVER_REGISTRY.size).toBe(29)
  })
})

type FakePageOpts = {
  sitekey?: string
  recaptchaKey?: string
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
      if (fnSrc.includes("recaptcha") && opts.recaptchaKey) {
        return opts.recaptchaKey
      }
      if (fnSrc.includes("navigator.userAgent")) {
        return opts.userAgent ?? null
      }
      return null
    },
    waitForRequest: async () => ({ postData: () => opts.rqdata ? `rqdata=${encodeURIComponent(opts.rqdata)}` : null, url: () => "https://api.hcaptcha.com/getcaptcha/10000000-ffff-ffff-ffff-000000000001" }),
  } as unknown as Page
}
