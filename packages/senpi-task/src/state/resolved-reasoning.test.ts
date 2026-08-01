import { describe, expect, test } from "bun:test"
import { readResolvedReasoning, resolvedReasoningFields } from "./resolved-reasoning"
import type { ResolvedModelRecord } from "./types"

const BASE: ResolvedModelRecord = {
  provider: "openai",
  model_id: "gpt-5.6-sol",
  display: "GPT-5.6 Sol",
  source: "category",
}

describe("readResolvedReasoning", () => {
  test("#given a canonical reasoning field #when read #then it wins over legacy spellings", () => {
    // given
    const record: ResolvedModelRecord = { ...BASE, reasoning: "xhigh", reasoning_effort: "low", variant: "medium" }

    // when
    const reasoning = readResolvedReasoning(record)

    // then
    expect(reasoning).toBe("xhigh")
  })

  test("#given a legacy reasoning_effort record #when read #then the legacy effort is used", () => {
    // given
    const record: ResolvedModelRecord = { ...BASE, reasoning_effort: "minimal", variant: "high" }

    // when
    const reasoning = readResolvedReasoning(record)

    // then
    expect(reasoning).toBe("minimal")
  })

  test("#given only a legacy variant #when read #then the variant is used", () => {
    // given
    const record: ResolvedModelRecord = { ...BASE, variant: "high" }

    // when
    const reasoning = readResolvedReasoning(record)

    // then
    expect(reasoning).toBe("high")
  })

  test("#given no reasoning of any spelling #when read #then it is undefined", () => {
    // given / when
    const reasoning = readResolvedReasoning(BASE)

    // then
    expect(reasoning).toBeUndefined()
  })
})

describe("resolvedReasoningFields", () => {
  test("#given a legacy effort record #when fields are built #then canonical and legacy mirror carry the effort", () => {
    // given
    const record: ResolvedModelRecord = { ...BASE, reasoning_effort: "minimal", variant: "high" }

    // when
    const fields = resolvedReasoningFields(record)

    // then
    expect(fields).toEqual({ reasoning: "minimal", variant: "minimal" })
  })

  test("#given no reasoning #when fields are built #then nothing is invented", () => {
    // given / when
    const fields = resolvedReasoningFields(BASE)

    // then
    expect(fields).toEqual({})
  })
})
