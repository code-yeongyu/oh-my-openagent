import { describe, expect, it } from "bun:test"
import { classifyPianoA } from "./piano-a-classifier.ts"
import type { ClassifierInput } from "./types.ts"

function createInput(
  overrides: Partial<ClassifierInput> = {},
): ClassifierInput {
  return {
    status: "Accepted",
    extensionsIn: 1,
    extensionsTotal: 1,
    proofChainKind: "unknown",
    hasResidualDefeasibleSupport: false,
    ...overrides,
  }
}

describe("classifyPianoA", () => {
  it("returns plausibile for Accepted in all extensions with strict proof", () => {
    expect(
      classifyPianoA(
        createInput({
          proofChainKind: "strict",
          extensionsIn: 3,
          extensionsTotal: 3,
        }),
      ),
    ).toBe("plausibile")
  })

  it("returns non_escluso for Accepted in all extensions with defeasible proof", () => {
    expect(
      classifyPianoA(
        createInput({
          proofChainKind: "defeasible",
          extensionsIn: 3,
          extensionsTotal: 3,
        }),
      ),
    ).toBe("non_escluso")
  })

  it("returns non_escluso for Accepted in some extensions", () => {
    expect(
      classifyPianoA(
        createInput({
          proofChainKind: "strict",
          extensionsIn: 2,
          extensionsTotal: 3,
        }),
      ),
    ).toBe("non_escluso")
  })

  it("returns possibile for Undecided", () => {
    expect(
      classifyPianoA(
        createInput({
          status: "Undecided",
          extensionsIn: 0,
          extensionsTotal: 2,
        }),
      ),
    ).toBe("possibile")
  })

  it("returns escluso_operativamente for Rejected with residual support", () => {
    expect(
      classifyPianoA(
        createInput({
          status: "Rejected",
          extensionsIn: 0,
          extensionsTotal: 2,
          hasResidualDefeasibleSupport: true,
        }),
      ),
    ).toBe("escluso_operativamente")
  })

  it("returns escluso for Rejected without residual support", () => {
    expect(
      classifyPianoA(
        createInput({
          status: "Rejected",
          extensionsIn: 0,
          extensionsTotal: 2,
        }),
      ),
    ).toBe("escluso")
  })

  it("returns possibile when status is undefined", () => {
    expect(
      classifyPianoA(
        createInput({
          status: undefined,
          extensionsIn: 0,
          extensionsTotal: 1,
        }),
      ),
    ).toBe("possibile")
  })

  it("returns possibile when extensions total is zero", () => {
    expect(
      classifyPianoA(
        createInput({
          extensionsIn: 0,
          extensionsTotal: 0,
        }),
      ),
    ).toBe("possibile")
  })

  it("returns plausibile for Accepted in 1 of 1 extension with strict proof", () => {
    expect(
      classifyPianoA(
        createInput({
          proofChainKind: "strict",
          extensionsIn: 1,
          extensionsTotal: 1,
        }),
      ),
    ).toBe("plausibile")
  })

  it("returns plausibile for Accepted in all extensions with mixed proof", () => {
    expect(
      classifyPianoA(
        createInput({
          proofChainKind: "mixed",
          extensionsIn: 4,
          extensionsTotal: 4,
        }),
      ),
    ).toBe("plausibile")
  })

  it("returns possibile when Accepted has zero support across known extensions", () => {
    expect(
      classifyPianoA(
        createInput({
          extensionsIn: 0,
          extensionsTotal: 3,
        }),
      ),
    ).toBe("possibile")
  })

  it("returns possibile when extensions indicate partial support despite unknown status", () => {
    expect(
      classifyPianoA(
        createInput({
          status: "Pending",
          extensionsIn: 1,
          extensionsTotal: 3,
        }),
      ),
    ).toBe("possibile")
  })
})
