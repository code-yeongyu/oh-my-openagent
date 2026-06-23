import { describe, expect, test } from "bun:test"
import { createFingerprintFamily } from "../fingerprint"
import { buildContextOptionsFromFamily } from "./context-options"
import { buildNavigatorOverrideScript } from "./init-script"

describe("buildContextOptionsFromFamily", () => {
  test("#given Chrome family #when context options built #then includes UA + viewport + sec-ch-* + accept-language", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "macos", locale: "en-US" })
    const opts = buildContextOptionsFromFamily(family)

    expect(opts.userAgent).toBe(family.userAgent)
    expect(opts.viewport).toEqual({ width: family.viewport.width, height: family.viewport.height })
    expect(opts.locale).toBe("en-US")
    expect(opts.timezoneId).toBe("America/New_York")
    expect(opts.extraHTTPHeaders).toMatchObject({
      "accept-language": family.acceptLanguage,
      "sec-ch-ua": family.secChUa,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    })
  })

  test("#given Firefox family #when context options built #then no sec-ch-* headers (Firefox does not emit Client Hints)", () => {
    const family = createFingerprintFamily({ browser: "firefox", os: "macos" })
    const opts = buildContextOptionsFromFamily(family)
    const headers = (opts.extraHTTPHeaders ?? {}) as Record<string, string>
    expect(headers["sec-ch-ua"]).toBeUndefined()
    expect(headers["sec-ch-ua-mobile"]).toBeUndefined()
    expect(headers["accept-language"]).toBeDefined()
  })
})

describe("buildNavigatorOverrideScript", () => {
  test("#given Chrome macOS family #when init script generated #then defines navigator.platform=MacIntel and hardwareConcurrency=10", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "macos" })
    const script = buildNavigatorOverrideScript(family)
    expect(script).toContain('navigator')
    expect(script).toContain("'platform'")
    expect(script).toContain('"MacIntel"')
    expect(script).toContain("'hardwareConcurrency'")
    expect(script).toContain("10")
  })

  test("#given Android Chrome mobile #when init script generated #then defines platform=Android", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "android", device: "mobile" })
    const script = buildNavigatorOverrideScript(family)
    expect(script).toContain('"Android"')
  })
})
