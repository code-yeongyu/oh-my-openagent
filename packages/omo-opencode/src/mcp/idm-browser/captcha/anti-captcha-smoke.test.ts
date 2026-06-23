import { describe, expect, test } from "bun:test"
import { getAntiCaptchaBalance, createAntiCaptchaTask } from "./anti-captcha-client"
import { resolveAntiCaptchaKey } from "../../../automation/network/anti-captcha-key"
import { resolveAntiCaptchaProxyUrl } from "../../../automation/network/anti-captcha-proxy"

const apiKey = resolveAntiCaptchaKey()
const proxyUrl = resolveAntiCaptchaProxyUrl()
const SHOULD_RUN = process.env.RUN_INTEGRATION === "1" && !!apiKey && !!proxyUrl

const integrationTest = SHOULD_RUN ? test : test.skip

describe("anti-captcha integration smoke", () => {
  integrationTest("#given valid key + Oxylabs proxy #when getBalance called #then returns numeric balance >= 0", async () => {
    const balance = await getAntiCaptchaBalance({ apiKey: apiKey!, proxyUrl: proxyUrl! })
    expect(typeof balance).toBe("number")
    expect(balance).toBeGreaterThanOrEqual(0)
  }, 30_000)

  integrationTest("#given valid auth + invalid domain #when createTask called #then auth works and proxy reaches anti-captcha", async () => {
    let caught: unknown = null
    try {
      await createAntiCaptchaTask({
        apiKey: apiKey!,
        type: "HCaptchaTask",
        websiteURL: "https://accounts.hcaptcha.com/demo",
        websiteKey: "10000000-ffff-ffff-ffff-000000000001",
        proxyUrl: proxyUrl!,
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    const message = caught instanceof Error ? caught.message : String(caught)
    expect(message).toMatch(/anti-captcha|ERROR_/i)
  }, 30_000)
})
