import { describe, expect, test } from "bun:test"
import {
  CapabilityViolationError,
  resolveCapabilities,
  SUPPORTED_MODEL_IDS,
} from "./model-capability-resolver"

describe("resolveCapabilities", () => {
  describe("#given pro base model", () => {
    describe("#when no extra body", () => {
      test("#then resolves to expert model_type with thinking default on, search off", () => {
        const r = resolveCapabilities("deepseek-v4-pro")
        expect(r.baseModel).toBe("deepseek-v4-pro")
        expect(r.modelType).toBe("expert")
        expect(r.thinkingEnabled).toBe(true)
        expect(r.searchEnabled).toBe(false)
        expect(r.canonicalModel).toBe("deepseek-v4-pro")
      })
    })

    describe("#when body.thinking true", () => {
      test("#then thinking on, search off", () => {
        const r = resolveCapabilities("deepseek-v4-pro", { thinking: true })
        expect(r.thinkingEnabled).toBe(true)
        expect(r.searchEnabled).toBe(false)
      })
    })

    describe("#when body.search true", () => {
      test("#then throws search_unsupported (expert rejects search; only flash supports it)", () => {
        expect(() =>
          resolveCapabilities("deepseek-v4-pro", { search: true }),
        ).toThrow(CapabilityViolationError)
        try {
          resolveCapabilities("deepseek-v4-pro", { search: true })
        } catch (err) {
          expect((err as CapabilityViolationError).code).toBe(
            "search_unsupported",
          )
        }
      })
    })

    describe("#when both body.thinking and body.search true", () => {
      test("#then throws search_unsupported (search gate fires first)", () => {
        expect(() =>
          resolveCapabilities("deepseek-v4-pro", {
            thinking: true,
            search: true,
          }),
        ).toThrow(CapabilityViolationError)
      })
    })

    describe("#when legacy thinking_enabled true", () => {
      test("#then resolves via legacy fallback", () => {
        const r = resolveCapabilities("deepseek-v4-pro", {
          thinking_enabled: true,
        })
        expect(r.thinkingEnabled).toBe(true)
      })
    })

    describe("#when canonical thinking false but legacy thinking_enabled true", () => {
      test("#then canonical wins (false)", () => {
        const r = resolveCapabilities("deepseek-v4-pro", {
          thinking: false,
          thinking_enabled: true,
        })
        expect(r.thinkingEnabled).toBe(false)
      })
    })
  })

  describe("#given flash base model", () => {
    describe("#when no extra body", () => {
      test("#then default model_type with all flags false", () => {
        const r = resolveCapabilities("deepseek-v4-flash")
        expect(r.baseModel).toBe("deepseek-v4-flash")
        expect(r.modelType).toBe("default")
        expect(r.thinkingEnabled).toBe(false)
        expect(r.searchEnabled).toBe(false)
      })
    })

    describe("#when body.thinking and body.search both true", () => {
      test("#then both flags on", () => {
        const r = resolveCapabilities("deepseek-v4-flash", {
          thinking: true,
          search: true,
        })
        expect(r.thinkingEnabled).toBe(true)
        expect(r.searchEnabled).toBe(true)
      })
    })
  })

  describe("#given vision base model", () => {
    describe("#when no extra body", () => {
      test("#then vision model_type with all flags false", () => {
        const r = resolveCapabilities("deepseek-v4-vision")
        expect(r.baseModel).toBe("deepseek-v4-vision")
        expect(r.modelType).toBe("vision")
        expect(r.thinkingEnabled).toBe(false)
        expect(r.searchEnabled).toBe(false)
      })
    })

    describe("#when body.thinking true", () => {
      test("#then thinking on", () => {
        const r = resolveCapabilities("deepseek-v4-vision", { thinking: true })
        expect(r.thinkingEnabled).toBe(true)
      })
    })

    describe("#when body.search true", () => {
      test("#then throws CapabilityViolationError search_unsupported", () => {
        expect(() =>
          resolveCapabilities("deepseek-v4-vision", { search: true }),
        ).toThrow(CapabilityViolationError)
        try {
          resolveCapabilities("deepseek-v4-vision", { search: true })
        } catch (err) {
          expect((err as CapabilityViolationError).code).toBe(
            "search_unsupported",
          )
        }
      })
    })

    describe("#when legacy search_enabled true", () => {
      test("#then also throws search_unsupported", () => {
        try {
          resolveCapabilities("deepseek-v4-vision", { search_enabled: true })
          throw new Error("should have thrown")
        } catch (err) {
          expect(err).toBeInstanceOf(CapabilityViolationError)
          expect((err as CapabilityViolationError).code).toBe(
            "search_unsupported",
          )
        }
      })
    })
  })

  describe("#given an unknown model", () => {
    describe("#when resolving gpt-4", () => {
      test("#then throws Unknown model and lists supported", () => {
        expect(() => resolveCapabilities("gpt-4")).toThrow(/Unknown model: gpt-4/)
        expect(() => resolveCapabilities("gpt-4")).toThrow(/Supported:/)
      })
    })

    describe("#when resolving deepseek-chat (legacy id)", () => {
      test("#then throws", () => {
        expect(() => resolveCapabilities("deepseek-chat")).toThrow(/Unknown model/)
      })
    })

    describe("#when resolving with -T suffix (no longer supported)", () => {
      test("#then throws Unknown model", () => {
        expect(() => resolveCapabilities("deepseek-v4-pro-T")).toThrow(
          /Unknown model/,
        )
      })
    })
  })

  describe("#given canonicalModel echo", () => {
    test("#when called with each supported id #then canonicalModel matches input verbatim", () => {
      for (const id of SUPPORTED_MODEL_IDS) {
        const r = resolveCapabilities(id)
        expect(r.canonicalModel).toBe(id)
      }
    })
  })

  describe("#given extra_body that is not an object", () => {
    test("#when null #then resolves with defaults", () => {
      const r = resolveCapabilities("deepseek-v4-pro", null)
      expect(r.thinkingEnabled).toBe(true)
      expect(r.searchEnabled).toBe(false)
    })

    test("#when string #then resolves with defaults", () => {
      const r = resolveCapabilities("deepseek-v4-pro", "ignored")
      expect(r.thinkingEnabled).toBe(true)
      expect(r.searchEnabled).toBe(false)
    })

    test("#when extra fields are not booleans #then ignored", () => {
      const r = resolveCapabilities("deepseek-v4-pro", {
        thinking: "yes",
        search: 1,
      })
      expect(r.thinkingEnabled).toBe(true)
      expect(r.searchEnabled).toBe(false)
    })
  })
})
