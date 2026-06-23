/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { CertaintySplitConfigSchema } from "./certainty-split"
import { ReasoningCoreConfigSchema } from "./reasoning-core"

describe("CertaintySplitConfigSchema", () => {
  describe("#given empty input", () => {
    it("#when parsed #then it uses certainty split defaults", () => {
      const result = CertaintySplitConfigSchema.parse({})

      expect(result.framework_high_threshold).toBe(0.75)
      expect(result.framework_medium_threshold).toBe(0.45)
      expect(result.world_high_threshold).toBe(0.75)
      expect(result.world_medium_threshold).toBe(0.45)
    })
  })

  describe("#given a high threshold below the medium threshold", () => {
    it("#when parsed #then it rejects the config", () => {
      expect(() =>
        CertaintySplitConfigSchema.parse({
          framework_high_threshold: 0.4,
          framework_medium_threshold: 0.45,
        })).toThrow()
    })
  })
})

describe("ReasoningCoreConfigSchema certainty_split", () => {
  describe("#given certainty split config", () => {
    it("#when parsed #then the optional field is accepted", () => {
      const result = ReasoningCoreConfigSchema.parse({
        certainty_split: {
          framework_high_threshold: 0.8,
          framework_medium_threshold: 0.5,
          world_high_threshold: 0.85,
          world_medium_threshold: 0.55,
        },
      })

      expect(result.certainty_split?.framework_high_threshold).toBe(0.8)
      expect(result.certainty_split?.world_medium_threshold).toBe(0.55)
    })
  })
})
