import { describe, expect, test } from "bun:test"
import { createFingerprintFamily } from "../fingerprint"
import { buildPoolConfigFromSession } from "./pool-config-builder"

describe("buildPoolConfigFromSession", () => {
  test("#given no family #when built #then engineOptions has no firefox_user_prefs and contextOptions is absent", () => {
    const config = buildPoolConfigFromSession({})
    expect(config.engineOptions?.locale).toBe("it-IT")
    expect((config.engineOptions as { firefox_user_prefs?: unknown }).firefox_user_prefs).toBeUndefined()
    expect(config.contextOptions).toBeUndefined()
    expect(config.contextDecorator).toBeUndefined()
  })

  test("#given Chrome family #when built #then context UA + viewport + sec-ch-* + firefox_user_prefs override #then locale flows through", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "macos", locale: "en-US" })
    const config = buildPoolConfigFromSession({ family })

    expect(config.contextOptions?.userAgent).toBe(family.userAgent)
    expect(config.contextOptions?.viewport).toEqual({ width: family.viewport.width, height: family.viewport.height })
    expect(config.contextOptions?.locale).toBe("en-US")
    expect(config.contextOptions?.timezoneId).toBe("America/New_York")
    expect((config.contextOptions?.extraHTTPHeaders ?? {})["sec-ch-ua"]).toBe(family.secChUa)

    const engineOpts = config.engineOptions as { firefox_user_prefs?: { "general.useragent.override"?: string }; locale?: string; window?: { width: number; height: number } }
    expect(engineOpts.firefox_user_prefs?.["general.useragent.override"]).toBe(family.userAgent)
    expect(engineOpts.locale).toBe("en-US")
    expect(engineOpts.window).toEqual({ width: family.viewport.width, height: family.viewport.height })
    expect(config.contextDecorator).toBeDefined()
  })

  test("#given proxy + family #when built #then proxy preserved alongside family options", () => {
    const family = createFingerprintFamily({ browser: "chrome", os: "windows" })
    const config = buildPoolConfigFromSession({
      family,
      proxy: { server: "http://proxy.example.com:8080", username: "u", password: "p" } as never,
    })
    const engineOpts = config.engineOptions as { proxy?: { server?: string; username?: string } }
    expect(engineOpts.proxy?.server).toBe("http://proxy.example.com:8080")
    expect(engineOpts.proxy?.username).toBe("u")
  })

  test("#given Firefox family #when built #then context options have no sec-ch-* but firefox_user_prefs override applied", () => {
    const family = createFingerprintFamily({ browser: "firefox", os: "macos" })
    const config = buildPoolConfigFromSession({ family })

    const headers = (config.contextOptions?.extraHTTPHeaders ?? {}) as Record<string, string>
    expect(headers["sec-ch-ua"]).toBeUndefined()
    expect(headers["accept-language"]).toBeDefined()

    const engineOpts = config.engineOptions as { firefox_user_prefs?: { "general.useragent.override"?: string } }
    expect(engineOpts.firefox_user_prefs?.["general.useragent.override"]).toBe(family.userAgent)
  })
})
