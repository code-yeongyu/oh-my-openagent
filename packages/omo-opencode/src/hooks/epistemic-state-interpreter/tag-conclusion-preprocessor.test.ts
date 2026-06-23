import { describe, expect, it } from "bun:test"

import {
  enrichParsedConclusionWithTags,
  extractTagsFromConclusion,
} from "./tag-conclusion-preprocessor"

describe("extractTagsFromConclusion", () => {
  describe("#given conclusion strings with supported tags", () => {
    it("#when the conclusion includes @risk:catastrophic:mortality_high #then extracts a risk premise tag", () => {
      const result = extractTagsFromConclusion("reject deployment @risk:catastrophic:mortality_high")

      expect(result).toEqual({
        premiseTags: ["risk:mortality_high"],
        optionId: null,
        riskLevel: "mortality_high",
        contamAxis: null,
        valencePolarity: null,
        valenceSeverity: null,
        valueDimension: null,
      })
    })

    it("#when the conclusion includes @contam:coi:neurosynthetic #then extracts a contamination premise tag", () => {
      const result = extractTagsFromConclusion("defer approval @contam:coi:neurosynthetic")

      expect(result).toEqual({
        premiseTags: ["contamination:neurosynthetic"],
        optionId: null,
        riskLevel: null,
        contamAxis: "coi:neurosynthetic",
        valencePolarity: null,
        valenceSeverity: null,
        valueDimension: null,
      })
    })

    it("#when the conclusion includes @valence:harm:critical #then extracts a harm premise tag", () => {
      const result = extractTagsFromConclusion("block rollout @valence:harm:critical")

      expect(result).toEqual({
        premiseTags: ["harm:critical"],
        optionId: null,
        riskLevel: null,
        contamAxis: null,
        valencePolarity: "harm",
        valenceSeverity: "critical",
        valueDimension: null,
      })
    })

    it("#when the conclusion includes @option:option_f #then extracts an option premise tag", () => {
      const result = extractTagsFromConclusion("select fallback @option:option_f")

      expect(result).toEqual({
        premiseTags: ["option:option_f"],
        optionId: "option_f",
        riskLevel: null,
        contamAxis: null,
        valencePolarity: null,
        valenceSeverity: null,
        valueDimension: null,
      })
    })

    it("#when the conclusion includes @value:transparency #then extracts a value premise tag", () => {
      const result = extractTagsFromConclusion("prefer disclosure @value:transparency")

      expect(result).toEqual({
        premiseTags: ["value:transparency"],
        optionId: null,
        riskLevel: null,
        contamAxis: null,
        valencePolarity: null,
        valenceSeverity: null,
        valueDimension: "transparency",
      })
    })

    it("#when the conclusion includes multiple supported tags #then extracts all mapped premise tags", () => {
      const result = extractTagsFromConclusion(
        "reject option @risk:catastrophic:identity_loss @contam:coi:neurosynthetic @valence:harm:critical @option:option_f @value:transparency",
      )

      expect(result).toEqual({
        premiseTags: [
          "risk:identity_loss",
          "contamination:neurosynthetic",
          "harm:critical",
          "option:option_f",
          "value:transparency",
        ],
        optionId: "option_f",
        riskLevel: "identity_loss",
        contamAxis: "coi:neurosynthetic",
        valencePolarity: "harm",
        valenceSeverity: "critical",
        valueDimension: "transparency",
      })
    })

    it("#when the conclusion includes no supported tags #then returns empty premise tags", () => {
      const result = extractTagsFromConclusion("keep monitoring evidence")

      expect(result).toEqual({
        premiseTags: [],
        optionId: null,
        riskLevel: null,
        contamAxis: null,
        valencePolarity: null,
        valenceSeverity: null,
        valueDimension: null,
      })
    })
  })
})

describe("enrichParsedConclusionWithTags", () => {
  it("#when merging existing and extracted tags #then de-duplicates overlapping premise tags", () => {
    const result = enrichParsedConclusionWithTags(
      "proceed with caution @option:option_f @value:transparency",
      ["existing:tag", "option:option_f"],
    )

    expect(result).toEqual(["existing:tag", "option:option_f", "value:transparency"])
  })
})
