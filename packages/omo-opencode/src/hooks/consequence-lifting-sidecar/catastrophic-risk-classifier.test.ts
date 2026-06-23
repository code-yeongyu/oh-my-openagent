import { describe, expect, it, spyOn } from "bun:test"

import { classifyCatastrophicRisk } from "./catastrophic-risk-classifier"

describe("catastrophic risk classifier", () => {
  describe("#given conclusion with @risk:catastrophic:mortality_high tag", () => {
    it("#when classify #then returns catastrophicGated true with threshold mortality_high", () => {
      const result = classifyCatastrophicRisk("deploy option @risk:catastrophic:mortality_high", [])

      expect(result.catastrophicGated).toBe(true)
      expect(result.threshold).toBe("mortality_high")
      expect(result.reasons).toEqual(["mortality_high"])
    })
  })

  describe("#given conclusion with @risk:catastrophic:unbounded_tail tag", () => {
    it("#when classify #then returns catastrophicGated true with threshold unbounded_tail", () => {
      const result = classifyCatastrophicRisk("deploy option @risk:catastrophic:unbounded_tail", [])

      expect(result.catastrophicGated).toBe(true)
      expect(result.threshold).toBe("unbounded_tail")
      expect(result.reasons).toEqual(["unbounded_tail"])
    })
  })

  describe("#given conclusion without @risk tag", () => {
    it("#when classify #then returns catastrophicGated false", () => {
      const result = classifyCatastrophicRisk("deploy option without special risk marker", [])

      expect(result.catastrophicGated).toBe(false)
      expect(result.threshold).toBeNull()
      expect(result.reasons).toEqual([])
    })
  })

  describe("#given conclusion with unknown threshold @risk:catastrophic:unknown_threshold", () => {
    it("#when classify #then returns catastrophicGated false silently", () => {
      const result = classifyCatastrophicRisk("deploy option @risk:catastrophic:unknown_threshold", [])

      expect(result.catastrophicGated).toBe(false)
      expect(result.threshold).toBeNull()
      expect(result.reasons).toEqual([])
    })
  })

  describe("#given MNEMOSYNE-style option_a with 31% mortality tag", () => {
    it("#when classify option_a conclusion #then catastrophicGated true", () => {
      const result = classifyCatastrophicRisk(
        "option_a yields 31% mortality under downside branch @risk:catastrophic:mortality_high",
        [],
      )

      expect(result.catastrophicGated).toBe(true)
      expect(result.threshold).toBe("mortality_high")
      expect(result.reasons).toEqual(["mortality_high"])
    })
  })
})
