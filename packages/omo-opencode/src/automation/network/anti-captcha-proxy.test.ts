import { describe, expect, test } from "bun:test"
import { resolveAntiCaptchaProxyUrl } from "./anti-captcha-proxy"

describe("resolveAntiCaptchaProxyUrl", () => {
  test("#given OXYLABS_AUTH user:pass #when resolved #then returns Oxylabs proxy URL", () => {
    const url = resolveAntiCaptchaProxyUrl({ env: { OXYLABS_AUTH: "myuser:mypass" } })
    expect(url).toBe("http://myuser:mypass@pr.oxylabs.io:7777")
  })

  test("#given ANTI_CAPTCHA_PROXY_URL #when resolved #then returns explicit override", () => {
    const url = resolveAntiCaptchaProxyUrl({
      env: { ANTI_CAPTCHA_PROXY_URL: "http://override:9999", OXYLABS_AUTH: "u:p" },
    })
    expect(url).toBe("http://override:9999")
  })

  test("#given no env vars #when resolved #then returns undefined", () => {
    expect(resolveAntiCaptchaProxyUrl({ env: {} })).toBeUndefined()
  })

  test("#given malformed OXYLABS_AUTH #when resolved #then returns undefined", () => {
    expect(resolveAntiCaptchaProxyUrl({ env: { OXYLABS_AUTH: "userwithoutcolon" } })).toBeUndefined()
    expect(resolveAntiCaptchaProxyUrl({ env: { OXYLABS_AUTH: ":" } })).toBeUndefined()
    expect(resolveAntiCaptchaProxyUrl({ env: { OXYLABS_AUTH: "user:" } })).toBeUndefined()
  })

  test("#given user/pass with special chars #when resolved #then encodes them", () => {
    const url = resolveAntiCaptchaProxyUrl({ env: { OXYLABS_AUTH: "user@with-special:p@ss" } })
    expect(url).toBe("http://user%40with-special:p%40ss@pr.oxylabs.io:7777")
  })
})
