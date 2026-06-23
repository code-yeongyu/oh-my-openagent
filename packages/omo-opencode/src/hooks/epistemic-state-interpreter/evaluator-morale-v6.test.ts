import { describe, expect, test } from "bun:test"

import type { MoralContextDefaults } from "../../config/schema/epistemic-v6"
import { evaluateMorale, type MoraleInput } from "./evaluator-morale-v6"

const DEFAULT_DEFAULTS: MoralContextDefaults = {
  default_audience: "general",
  require_audience_model: false,
}

function createInput(overrides: Partial<MoraleInput> = {}): MoraleInput {
  return {
    conclusion: "allow the response",
    premiseTags: [],
    audienceType: "general",
    conclusionAction: null,
    hasQualifications: false,
    competingArgumentCount: 0,
    defaults: DEFAULT_DEFAULTS,
    ...overrides,
  }
}

describe("evaluateMorale", () => {
  test("returns a null score when no audience model is available and one is required", () => {
    const result = evaluateMorale(
      createInput({
        audienceType: null,
        defaults: { default_audience: "general", require_audience_model: true },
      }),
    )

    expect(result).toEqual({
      score: null,
      label: null,
    contesto_sociale: null,
      comprensione_destinatari: null,
      impatto_cascata: 0,
      intenzione: "neutra",
      trasparenza: 0,
      fiducia_risultante: 0,
      reason: "no_moral_context",
    })
  })

  test("returns a null score when no moral tags exist and no audience is provided", () => {
    const result = evaluateMorale(
      createInput({
        premiseTags: ["evidence:data"],
        audienceType: null,
        defaults: { default_audience: "general", require_audience_model: false },
      }),
    )

    expect(result).toEqual({
      score: null,
      label: null,
      contesto_sociale: null,
      comprensione_destinatari: null,
      impatto_cascata: 0,
      intenzione: "neutra",
      trasparenza: 0,
      fiducia_risultante: 0,
      reason: "no_moral_context",
    })
  })

  test("uses the configured default audience when audience modeling is optional", () => {
    const result = evaluateMorale(
      createInput({
        premiseTags: ["safety:child"],
        audienceType: null,
        defaults: { default_audience: "vulnerable", require_audience_model: false },
      }),
    )

    expect(result.score).not.toBeNull()
    expect(result.contesto_sociale).toBe("vulnerable")
  })

  test("assigns high comprehension to expert audiences", () => {
    const result = evaluateMorale(createInput({ audienceType: "expert" }))

    expect(result.comprensione_destinatari).toBe("expert (0.9)")
  })

  test("assigns low comprehension to vulnerable audiences", () => {
    const result = evaluateMorale(createInput({ audienceType: "vulnerable" }))

    expect(result.comprensione_destinatari).toBe("vulnerable (0.2)")
  })

  test("treats protection-heavy premise tags as benevolent intent", () => {
    const neutral = evaluateMorale(createInput())
    const benevolent = evaluateMorale(
      createInput({ premiseTags: ["safety:child", "protection:abuse", "care:wellbeing"] }),
    )

    expect(benevolent.intenzione).toBe("benevola")
    expect(benevolent.score).toBeGreaterThan(neutral.score ?? -1)
  })

  test("treats exploitation-heavy premise tags as malevolent intent", () => {
    const neutral = evaluateMorale(createInput())
    const malevolent = evaluateMorale(
      createInput({ premiseTags: ["commercial:upsell", "self-interest:retention", "deceptive:masking"] }),
    )

    expect(malevolent.intenzione).toBe("malevola")
    expect(malevolent.score).toBeLessThan(neutral.score ?? 1)
  })

  test("treats balanced tags as neutral intent", () => {
    const result = evaluateMorale(
      createInput({ premiseTags: ["safety:child", "commercial:upsell"] }),
    )

    expect(result.intenzione).toBe("neutra")
  })

  test("increases transparency when the conclusion includes qualifications", () => {
    const opaque = evaluateMorale(createInput({ hasQualifications: false }))
    const qualified = evaluateMorale(createInput({ hasQualifications: true }))

    expect(qualified.trasparenza).toBeGreaterThan(opaque.trasparenza)
    expect(qualified.score).toBeGreaterThan(opaque.score ?? -1)
  })

  test("gives block actions a lower cascade impact than allow actions", () => {
    const block = evaluateMorale(createInput({ conclusionAction: "block" }))
    const allow = evaluateMorale(createInput({ conclusionAction: "allow" }))

    expect(block.impatto_cascata).toBeLessThan(allow.impatto_cascata)
  })

  test("gives allow actions a higher cascade impact than restrict actions", () => {
    const restrict = evaluateMorale(createInput({ conclusionAction: "restrict" }))
    const allow = evaluateMorale(createInput({ conclusionAction: "allow" }))

    expect(allow.impatto_cascata).toBeGreaterThan(restrict.impatto_cascata)
  })

  test("raises cascade impact for highly contested conclusions", () => {
    const uncontested = evaluateMorale(createInput({ competingArgumentCount: 0 }))
    const contested = evaluateMorale(createInput({ competingArgumentCount: 5 }))

    expect(contested.impatto_cascata).toBeGreaterThan(uncontested.impatto_cascata)
  })

  test("does not return a 0.5 placeholder score and varies with input", () => {
    const cautious = evaluateMorale(
      createInput({
        audienceType: "expert",
        conclusionAction: "block",
        hasQualifications: true,
        premiseTags: ["safety:child"],
      }),
    )
    const risky = evaluateMorale(
      createInput({
        audienceType: "vulnerable",
        conclusionAction: "allow",
        competingArgumentCount: 4,
        premiseTags: ["deceptive:masking"],
      }),
    )

    expect(cautious.score).not.toBe(0.5)
    expect(risky.score).not.toBe(0.5)
    expect(cautious.score).not.toBe(risky.score)
  })

  test("populates all output fields when an audience model exists", () => {
    const result = evaluateMorale(createInput({ audienceType: "general", hasQualifications: true }))

    expect(result.score).not.toBeNull()
    expect(result.contesto_sociale).toBe("general")
    expect(result.comprensione_destinatari).toBe("general (0.5)")
    expect(typeof result.impatto_cascata).toBe("number")
    expect(result.intenzione).toBe("neutra")
    expect(typeof result.trasparenza).toBe("number")
    expect(typeof result.fiducia_risultante).toBe("number")
    expect(result.reason).toBeNull()
  })
})
