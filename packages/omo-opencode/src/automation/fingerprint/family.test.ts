import { describe, expect, test } from "bun:test"
import { createFingerprintFamily } from "./family"

describe("createFingerprintFamily", () => {
  test("#given browser=chrome os=macos #when created #then returns frozen Chrome macOS family with sec-ch-ua", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "macos", locale: "en-US" })

    expect(family.browser).toBe("chrome")
    expect(family.os).toBe("macos")
    expect(family.platform).toBe("MacIntel")
    expect(family.userAgent).toContain("Macintosh")
    expect(family.userAgent).toContain("Chrome/")
    expect(family.timezone).toBe("America/New_York")
    expect(family.locale).toBe("en-US")
    expect(family.acceptLanguage).toContain("en-US")
    expect(family.secChUa).toContain("Google Chrome")
    expect(family.secChUaPlatform).toBe('"macOS"')
    expect(family.secChUaMobile).toBe("?0")
    expect(Object.isFrozen(family)).toBe(true)
  })

  test("#given browser=firefox #when created #then secChUa is empty (Firefox does not emit Client Hints)", () => {
    const family = createFingerprintFamily({ browser: "firefox", os: "macos", locale: "en-GB" })

    expect(family.browser).toBe("firefox")
    expect(family.secChUa).toBe("")
    expect(family.secChUaFullVersionList).toBe("")
    expect(family.timezone).toBe("Europe/London")
  })

  test("#given browser=safari device=mobile #when created #then platform iPhone and secChUaMobile ?1", () => {
    const family = createFingerprintFamily({ browser: "safari", os: "ios", device: "mobile", locale: "it-IT" })

    expect(family.os).toBe("ios")
    expect(family.device).toBe("mobile")
    expect(family.platform).toBe("iPhone")
    expect(family.secChUaMobile).toBe("?1")
    expect(family.timezone).toBe("Europe/Rome")
  })

  test("#given browser=edge #when created #then secChUa starts with Microsoft Edge", () => {
    const family = createFingerprintFamily({ browser: "edge", os: "windows" })

    expect(family.browser).toBe("edge")
    expect(family.secChUa.startsWith('"Microsoft Edge"')).toBe(true)
    expect(family.platform).toBe("Win32")
  })

  test("#given chrome desktop default #when created twice with same seed #then returns identical family (deterministic with seed)", () => {
    const a = createFingerprintFamily({ browser: "chrome", os: "windows", seed: 1 })
    const b = createFingerprintFamily({ browser: "chrome", os: "windows", seed: 1 })
    expect(a).toEqual(b)
  })

  test("#given hardwareConcurrency #when generated for desktop macos #then is 10", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "macos" })
    expect(family.hardwareConcurrency).toBe(10)
  })

  test("#given hardwareConcurrency #when generated for android mobile #then is 8", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "android", device: "mobile" })
    expect(family.hardwareConcurrency).toBe(8)
  })

  test("#given viewport for desktop #when generated #then has width >= 1366", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "windows", device: "desktop" })
    expect(family.viewport.width).toBeGreaterThanOrEqual(1366)
    expect(family.viewport.height).toBeGreaterThanOrEqual(768)
  })

  test("#given viewport for mobile #when generated #then has portrait orientation (height > width)", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "android", device: "mobile" })
    expect(family.viewport.height).toBeGreaterThan(family.viewport.width)
  })

  test("#given immutable family #when attempting to mutate #then throws or no-op (frozen)", () => {
    const family = createFingerprintFamily({})
    expect(() => {
      ;(family as unknown as { browser: string }).browser = "muted"
    }).toThrow()
  })

  test("#given different seeds #when generated within same browser+os #then can produce different UAs", () => {
    const families = Array.from({ length: 6 }, (_, i) =>
      createFingerprintFamily({ browser: "chrome", os: "windows", seed: i }),
    )
    const uniqueUas = new Set(families.map((f) => f.userAgent))
    expect(uniqueUas.size).toBeGreaterThan(1)
  })
})
