import { describe, expect, test } from "bun:test"
import { resolveOpenAICompatConfig, OpenAICompatConfigError } from "./config"

describe("resolveOpenAICompatConfig", () => {
  describe("#given missing bearer token", () => {
    test("#when env empty #then throws OpenAICompatConfigError", () => {
      expect(() => resolveOpenAICompatConfig({})).toThrow(OpenAICompatConfigError)
    })
  })

  describe("#given bearer token only", () => {
    test("#when minimal env #then returns defaults for host/port/version", () => {
      const cfg = resolveOpenAICompatConfig({
        IDM_OPENAI_COMPAT_BEARER_TOKEN: "abc",
      })
      expect(cfg.bearer_token).toBe("abc")
      expect(cfg.host).toBe("127.0.0.1")
      expect(cfg.port).toBe(38_000)
      expect(cfg.version).toBe("0.4.0")
    })
  })

  describe("#given full env override", () => {
    test("#when host/port/version set #then config reflects them", () => {
      const cfg = resolveOpenAICompatConfig({
        IDM_OPENAI_COMPAT_BEARER_TOKEN: "abc",
        IDM_OPENAI_COMPAT_HOST: "0.0.0.0",
        IDM_OPENAI_COMPAT_PORT: "0",
        IDM_OPENAI_COMPAT_VERSION: "0.4.1",
      })
      expect(cfg.host).toBe("0.0.0.0")
      expect(cfg.port).toBe(0)
      expect(cfg.version).toBe("0.4.1")
    })
  })

  describe("#given invalid port", () => {
    test("#when non-numeric #then throws", () => {
      expect(() =>
        resolveOpenAICompatConfig({
          IDM_OPENAI_COMPAT_BEARER_TOKEN: "abc",
          IDM_OPENAI_COMPAT_PORT: "abc",
        }),
      ).toThrow(OpenAICompatConfigError)
    })

    test("#when out of range #then throws", () => {
      expect(() =>
        resolveOpenAICompatConfig({
          IDM_OPENAI_COMPAT_BEARER_TOKEN: "abc",
          IDM_OPENAI_COMPAT_PORT: "99999",
        }),
      ).toThrow(OpenAICompatConfigError)
    })
  })
})
