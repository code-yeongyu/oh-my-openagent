import { describe, expect, it } from "bun:test"
import { extractProxyUrl, isProxyMarkerKey, PROXY_URL_MARKER } from "./proxy-config"

describe("extractProxyUrl", () => {
  describe("#given null or undefined input", () => {
    it("#when input is null #then returns empty headers and null proxy", () => {
      const r = extractProxyUrl(null)
      expect(r.proxyUrl).toBeNull()
      expect(r.headers).toEqual({})
    })
    it("#when input is undefined #then returns empty headers and null proxy", () => {
      const r = extractProxyUrl(undefined)
      expect(r.proxyUrl).toBeNull()
      expect(r.headers).toEqual({})
    })
    it("#when input is empty string #then returns empty headers and null proxy", () => {
      const r = extractProxyUrl("")
      expect(r.proxyUrl).toBeNull()
      expect(r.headers).toEqual({})
    })
  })

  describe("#given malformed JSON", () => {
    it("#when input is not valid JSON #then returns empty headers and null proxy", () => {
      const r = extractProxyUrl("{not-json")
      expect(r.proxyUrl).toBeNull()
      expect(r.headers).toEqual({})
    })
    it("#when input is JSON array #then returns empty headers and null proxy", () => {
      const r = extractProxyUrl(JSON.stringify(["a", "b"]))
      expect(r.proxyUrl).toBeNull()
      expect(r.headers).toEqual({})
    })
  })

  describe("#given headers without proxy marker", () => {
    it("#when only HTTP headers present #then returns headers and null proxy", () => {
      const json = JSON.stringify({ "X-App-Version": "20241129.1", Origin: "https://chat.deepseek.com" })
      const r = extractProxyUrl(json)
      expect(r.proxyUrl).toBeNull()
      expect(r.headers).toEqual({ "X-App-Version": "20241129.1", Origin: "https://chat.deepseek.com" })
    })
  })

  describe("#given headers with proxy marker", () => {
    it("#when SOCKS5 proxy present #then returns proxy URL and headers without marker", () => {
      const json = JSON.stringify({
        __proxy_url__: "socks5h://user:pass@proxy.host:20000",
        "X-App-Version": "20241129.1",
        Origin: "https://chat.deepseek.com",
      })
      const r = extractProxyUrl(json)
      expect(r.proxyUrl).toBe("socks5h://user:pass@proxy.host:20000")
      expect(r.headers).toEqual({ "X-App-Version": "20241129.1", Origin: "https://chat.deepseek.com" })
      expect(Object.keys(r.headers)).not.toContain(PROXY_URL_MARKER)
    })
    it("#when proxy marker is empty string #then returns null proxy", () => {
      const json = JSON.stringify({ __proxy_url__: "", "X-App-Version": "v" })
      const r = extractProxyUrl(json)
      expect(r.proxyUrl).toBeNull()
      expect(r.headers).toEqual({ "X-App-Version": "v" })
    })
    it("#when proxy marker is non-string #then returns null proxy", () => {
      const json = JSON.stringify({ __proxy_url__: 123, "X-App-Version": "v" })
      const r = extractProxyUrl(json)
      expect(r.proxyUrl).toBeNull()
      expect(r.headers).toEqual({ "X-App-Version": "v" })
    })
    it("#when only proxy marker present #then returns proxy and empty headers", () => {
      const json = JSON.stringify({ __proxy_url__: "socks5://1.2.3.4:1080" })
      const r = extractProxyUrl(json)
      expect(r.proxyUrl).toBe("socks5://1.2.3.4:1080")
      expect(r.headers).toEqual({})
    })
  })

  describe("#given non-string header values", () => {
    it("#when value is not a string #then drops it from headers", () => {
      const json = JSON.stringify({ A: "1", B: 2, C: null, D: true })
      const r = extractProxyUrl(json)
      expect(r.headers).toEqual({ A: "1" })
    })
  })
})

describe("isProxyMarkerKey", () => {
  it("#when key is the marker #then returns true", () => {
    expect(isProxyMarkerKey("__proxy_url__")).toBe(true)
  })
  it("#when key is anything else #then returns false", () => {
    expect(isProxyMarkerKey("Authorization")).toBe(false)
    expect(isProxyMarkerKey("__proxy_url")).toBe(false)
    expect(isProxyMarkerKey("")).toBe(false)
  })
})

describe("PROXY_URL_MARKER constant", () => {
  it("#when read #then equals __proxy_url__", () => {
    expect(PROXY_URL_MARKER).toBe("__proxy_url__")
  })
})
