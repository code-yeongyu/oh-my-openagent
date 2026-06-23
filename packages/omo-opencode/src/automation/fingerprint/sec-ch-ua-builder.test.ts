import { describe, expect, test } from "bun:test"
import { buildSecChUa, parseUserAgent } from "./sec-ch-ua-builder"

describe("parseUserAgent", () => {
  test("#given Chrome 148 desktop Windows #when parsed #then returns chromium chrome 148 windows desktop", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.97 Safari/537.36"
    const parsed = parseUserAgent(ua)
    expect(parsed).toMatchObject({ engine: "chromium", brand: "chrome", major: "148", full: "148.0.7778.97", os: "windows", isMobile: false })
  })

  test("#given Edge 147 desktop #when parsed #then returns chromium edge 147", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.3912.98"
    const parsed = parseUserAgent(ua)
    expect(parsed.brand).toBe("edge")
    expect(parsed.major).toBe("147")
  })

  test("#given Firefox 150 #when parsed #then engine is firefox", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0"
    expect(parseUserAgent(ua).engine).toBe("firefox")
  })

  test("#given Safari 26 macOS #when parsed #then engine is safari", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 26_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
    expect(parseUserAgent(ua).engine).toBe("safari")
    expect(parseUserAgent(ua).os).toBe("macos")
  })

  test("#given Chrome on Android #when parsed #then isMobile true os android", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7700.84 Mobile Safari/537.36"
    const parsed = parseUserAgent(ua)
    expect(parsed.os).toBe("android")
    expect(parsed.isMobile).toBe(true)
    expect(parsed.engine).toBe("chromium")
  })

  test("#given CriOS Chrome on iPhone #when parsed #then engine chromium os ios", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/148.0.7778.97 Mobile/15E148 Safari/604.1"
    const parsed = parseUserAgent(ua)
    expect(parsed.engine).toBe("chromium")
    expect(parsed.os).toBe("ios")
    expect(parsed.isMobile).toBe(true)
  })
})

describe("buildSecChUa", () => {
  test("#given Chrome 148 macOS desktop #when built #then matches Annex D format", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.97 Safari/537.36"
    const set = buildSecChUa(ua)
    expect(set).not.toBeNull()
    expect(set!.secChUa).toBe('"Chromium";v="148", "Google Chrome";v="148", "Not_A Brand";v="24"')
    expect(set!.secChUaFullVersionList).toBe('"Chromium";v="148.0.7778.97", "Google Chrome";v="148.0.7778.97", "Not_A Brand";v="24.0.0.0"')
    expect(set!.secChUaMobile).toBe("?0")
    expect(set!.secChUaPlatform).toBe('"macOS"')
  })

  test("#given Edge 147 Windows #when built #then includes Microsoft Edge brand first", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.3912.98"
    const set = buildSecChUa(ua)!
    expect(set.secChUa.startsWith('"Microsoft Edge";v="147"')).toBe(true)
    expect(set.secChUaPlatform).toBe('"Windows"')
  })

  test("#given Chrome on Android #when built #then secChUaMobile is ?1 platform Android", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7700.84 Mobile Safari/537.36"
    const set = buildSecChUa(ua)!
    expect(set.secChUaMobile).toBe("?1")
    expect(set.secChUaPlatform).toBe('"Android"')
  })

  test("#given Firefox 150 #when built #then returns null (no Client Hints emission)", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0"
    expect(buildSecChUa(ua)).toBeNull()
  })

  test("#given Safari 26 #when built #then returns null", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 26_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
    expect(buildSecChUa(ua)).toBeNull()
  })
})
