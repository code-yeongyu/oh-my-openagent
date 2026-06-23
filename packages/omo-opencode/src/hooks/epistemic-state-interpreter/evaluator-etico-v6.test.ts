import { describe, expect, it } from "bun:test"

import type { EthicalValueHierarchy } from "../../config/schema/epistemic-v6"
import { evaluateEtico, type EticoInput } from "./evaluator-etico-v6.ts"

const DEFAULT_HIERARCHY: EthicalValueHierarchy = [
  "vita_umana",
  "benessere_collettivo",
  "integrita_personale",
  "autonomia",
  "trasparenza",
  "convenienza",
]

function createInput(overrides: Partial<EticoInput> = {}): EticoInput {
  return {
    conclusion: "goal",
    proofChainKind: "unknown",
    premiseTags: [],
    extensionMembership: { inCount: 1, totalCount: 1 },
    valueHierarchy: DEFAULT_HIERARCHY,
    ...overrides,
  }
}

describe("evaluateEtico", () => {
  it("returns null when no ethical tags exist", () => {
    const result = evaluateEtico(createInput({ premiseTags: ["evidence:data"] }))

    expect(result).toEqual({
      score: null,
      label: null,
      allineamento_legale: 0,
      valore_empatico: 0,
      magnitudine_beneficio: 0,
      override: false,
      reason: "no_ethical_context",
    })
  })

  it("increases legal alignment when legal support tags are present", () => {
    const result = evaluateEtico(createInput({ premiseTags: ["legal:gdpr"] }))

    expect(result.allineamento_legale).toBe(0.65)
    expect(result.score).toBe(0.415)
  })

  it("caps legal alignment at 1.0 with many legal tags", () => {
    const result = evaluateEtico(
      createInput({
        premiseTags: [
          "legal:gdpr",
          "regulatory:ai-act",
          "compliance:soc2",
          "legal:consumer-law",
        ],
      })
    )

    expect(result.allineamento_legale).toBe(1)
  })

  it("maps vita_umana to the top empathetic value", () => {
    const result = evaluateEtico(createInput({ premiseTags: ["value:vita_umana"] }))

    expect(result.valore_empatico).toBe(1)
    expect(result.magnitudine_beneficio).toBe(0.8)
  })

  it("maps convenienza to the bottom empathetic value", () => {
    const result = evaluateEtico(createInput({ premiseTags: ["value:convenienza"] }))

    expect(result.valore_empatico).toBe(0)
    expect(result.magnitudine_beneficio).toBe(0)
  })

  it("triggers the override for high-value protection despite low legal alignment", () => {
    const result = evaluateEtico(
      createInput({
        proofChainKind: "strict",
        premiseTags: ["value:vita_umana"],
      })
    )

    expect(result.override).toBe(true)
    expect(result.score).toBe(0.94)
  })

  it("does not trigger the override when legal alignment is already high", () => {
    const result = evaluateEtico(
      createInput({
        proofChainKind: "strict",
        premiseTags: ["legal:emergency-order", "value:vita_umana"],
      })
    )

    expect(result.override).toBe(false)
  })

  it("does not trigger the override for low-level values", () => {
    const result = evaluateEtico(
      createInput({
        proofChainKind: "strict",
        premiseTags: ["value:convenienza"],
      })
    )

    expect(result.override).toBe(false)
  })

  it("gives strict proof chains the highest logical contribution", () => {
    const result = evaluateEtico(
      createInput({ proofChainKind: "strict", premiseTags: ["legal:baseline"] })
    )

    expect(result.score).toBe(0.625)
  })

  it("gives defeasible proof chains a lower logical contribution", () => {
    const result = evaluateEtico(
      createInput({ proofChainKind: "defeasible", premiseTags: ["legal:baseline"] })
    )

    expect(result.score).toBe(0.475)
  })

  it("rounds the final score to three decimal places", () => {
    const result = evaluateEtico(
      createInput({
        proofChainKind: "mixed",
        premiseTags: ["value:autonomia"],
        valueHierarchy: ["vita_umana", "autonomia", "trasparenza", "convenienza"],
      })
    )

    expect(result.score).toBe(0.493)
  })

  it("uses reasonable defaults for legal-only premise tags instead of placeholder values", () => {
    const result = evaluateEtico(
      createInput({ proofChainKind: "strict", premiseTags: ["legal:baseline"] })
    )

    expect(result.allineamento_legale).toBe(0.65)
    expect(result.valore_empatico).toBe(0)
    expect(result.magnitudine_beneficio).toBe(0)
    expect(result.score).toBe(0.625)
    expect(result.score).not.toBe(0.5)
  })
})
