import { describe, expect, test } from "bun:test"
import {
  isSupportedModel,
  MODEL_CAPABILITY_MATRIX,
  SUPPORTED_MODEL_IDS,
} from "./model-capability-resolver"

describe("isSupportedModel", () => {
  describe("#given a known base model", () => {
    test("#when each id is checked #then returns true", () => {
      for (const id of SUPPORTED_MODEL_IDS) {
        expect(isSupportedModel(id)).toBe(true)
      }
    })
  })

  describe("#given unknown ids", () => {
    test("#when checked #then returns false", () => {
      expect(isSupportedModel("deepseek-chat")).toBe(false)
      expect(isSupportedModel("deepseek-reasoner")).toBe(false)
      expect(isSupportedModel("gpt-4")).toBe(false)
      expect(isSupportedModel("")).toBe(false)
    })
  })

  describe("#given suffix variants (no longer SKUs in V0.10.3 variants pattern)", () => {
    test("#when checked #then returns false (variants are body fields, not model ids)", () => {
      expect(isSupportedModel("deepseek-v4-pro-T")).toBe(false)
      expect(isSupportedModel("deepseek-v4-pro-S")).toBe(false)
      expect(isSupportedModel("deepseek-v4-pro-T+S")).toBe(false)
      expect(isSupportedModel("deepseek-v4-flash-T")).toBe(false)
      expect(isSupportedModel("deepseek-v4-vision-S")).toBe(false)
    })
  })
})

describe("MODEL_CAPABILITY_MATRIX", () => {
  describe("#given the static matrix", () => {
    test("#when inspected #then has exactly the 3 base models", () => {
      const keys = Object.keys(MODEL_CAPABILITY_MATRIX).sort()
      expect(keys).toEqual([
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "deepseek-v4-vision",
      ])
    })

    test("#when reading vision #then thinkingAllowed is true and searchAllowed is false", () => {
      expect(MODEL_CAPABILITY_MATRIX["deepseek-v4-vision"].thinkingAllowed).toBe(
        true,
      )
      expect(MODEL_CAPABILITY_MATRIX["deepseek-v4-vision"].searchAllowed).toBe(
        false,
      )
    })

    test("#when reading pro #then modelType is expert", () => {
      expect(MODEL_CAPABILITY_MATRIX["deepseek-v4-pro"].modelType).toBe("expert")
    })

    test("#when reading pro #then thinkingAllowed is true and searchAllowed is false (server silent no-op; only flash supports search)", () => {
      expect(MODEL_CAPABILITY_MATRIX["deepseek-v4-pro"].thinkingAllowed).toBe(
        true,
      )
      expect(MODEL_CAPABILITY_MATRIX["deepseek-v4-pro"].searchAllowed).toBe(
        false,
      )
    })

    test("#when reading flash #then modelType is default", () => {
      expect(MODEL_CAPABILITY_MATRIX["deepseek-v4-flash"].modelType).toBe(
        "default",
      )
    })

    test("#when reading flash #then thinkingAllowed and searchAllowed are both true (only model supporting search)", () => {
      expect(MODEL_CAPABILITY_MATRIX["deepseek-v4-flash"].thinkingAllowed).toBe(
        true,
      )
      expect(MODEL_CAPABILITY_MATRIX["deepseek-v4-flash"].searchAllowed).toBe(
        true,
      )
    })
  })
})

describe("SUPPORTED_MODEL_IDS", () => {
  describe("#given the supported list", () => {
    test("#when measured #then contains exactly 3 base SKUs", () => {
      expect(SUPPORTED_MODEL_IDS.length).toBe(3)
    })

    test("#when inspected #then includes the 3 base ids only", () => {
      expect(SUPPORTED_MODEL_IDS).toContain("deepseek-v4-pro")
      expect(SUPPORTED_MODEL_IDS).toContain("deepseek-v4-flash")
      expect(SUPPORTED_MODEL_IDS).toContain("deepseek-v4-vision")
    })
  })
})
