import { describe, expect, test } from "bun:test"

import { asSenpiThinkingLevel } from "./thinking-level"

describe("asSenpiThinkingLevel", () => {
  test("#given every senpi thinking level #when validated #then it passes through verbatim", () => {
    // given / when / then
    for (const level of ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const) {
      expect(asSenpiThinkingLevel(level)).toBe(level)
    }
  })

  test("#given the omo.json reasoningEffort none #when validated #then it maps to senpi off", () => {
    // given / when / then
    expect(asSenpiThinkingLevel("none")).toBe("off")
  })

  test("#given an unknown variant string #when validated #then it is rejected so the child keeps the harness default", () => {
    // given / when / then
    expect(asSenpiThinkingLevel("ultra")).toBeUndefined()
    expect(asSenpiThinkingLevel("")).toBeUndefined()
    expect(asSenpiThinkingLevel("HIGH")).toBeUndefined()
  })

  test("#given undefined #when validated #then it stays undefined", () => {
    // given / when / then
    expect(asSenpiThinkingLevel(undefined)).toBeUndefined()
  })
})
