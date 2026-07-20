import { describe, expect, it } from "bun:test"
import { gateFinding, classifyProvenance } from "./finding-gate"
import type { Evidence } from "./types"

describe("classifyProvenance", () => {
  it("#given no evidence -> #when classify -> #then returns none", () => {
    // given
    const evidence: Evidence[] = []

    // when
    const result = classifyProvenance(evidence)

    // then
    expect(result).toBe("none")
  })

  it("#given tool evidence -> #when classify -> #then returns tool", () => {
    // given
    const evidence: Evidence[] = [
      { kind: "output", content: "command output" },
    ]

    // when
    const result = classifyProvenance(evidence)

    // then
    expect(result).toBe("tool")
  })

  it("#given context-only evidence -> #when classify -> #then returns context", () => {
    // given
    const evidence: Evidence[] = [
      { kind: "description", content: "model reasoning" },
    ]

    // when
    const result = classifyProvenance(evidence)

    // then
    expect(result).toBe("context")
  })
})

describe("gateFinding", () => {
  const fixedNow = () => "2026-01-01T00:00:00.000Z"

  it("#given tool-backed high severity -> #when gate -> #then passes", () => {
    // given
    const evidence: Evidence[] = [
      { kind: "output", content: "vulnerable response" },
    ]

    // when
    const gate = gateFinding({
      severity: "high",
      evidence,
      now: fixedNow,
    })

    // then
    expect(gate.passed).toBe(true)
    expect(gate.provenance).toBe("tool")
    expect(gate.reasons).toHaveLength(0)
  })

  it("#given no evidence high severity -> #when gate -> #then fails with reasons", () => {
    // given
    const evidence: Evidence[] = []

    // when
    const gate = gateFinding({
      severity: "high",
      evidence,
      now: fixedNow,
    })

    // then
    expect(gate.passed).toBe(false)
    expect(gate.provenance).toBe("none")
    expect(gate.reasons.length).toBeGreaterThan(0)
    expect(gate.reasons).toContain("no evidence provided")
    expect(gate.reasons).toContain("severity high requires tool-backed evidence")
  })

  it("#given context-only medium severity -> #when gate -> #then fails", () => {
    // given
    const evidence: Evidence[] = [
      { kind: "description", content: "model says it looks bad" },
    ]

    // when
    const gate = gateFinding({
      severity: "medium",
      evidence,
      now: fixedNow,
    })

    // then
    expect(gate.passed).toBe(false)
    expect(gate.provenance).toBe("context")
    expect(gate.reasons).toContain("evidence is contextual only, not backed by tool output")
    expect(gate.reasons).toContain("severity medium requires tool-backed evidence")
  })

  it("#given context-only info severity -> #when gate -> #then fails (tool required for all)", () => {
    // given
    const evidence: Evidence[] = [
      { kind: "description", content: "informational note" },
    ]

    // when
    const gate = gateFinding({
      severity: "info",
      evidence,
      now: fixedNow,
    })

    // then
    expect(gate.passed).toBe(false)
    expect(gate.provenance).toBe("context")
  })

  it("#given tool-backed info severity -> #when gate -> #then passes", () => {
    // given
    const evidence: Evidence[] = [
      { kind: "log", content: "access log entry" },
    ]

    // when
    const gate = gateFinding({
      severity: "info",
      evidence,
      now: fixedNow,
    })

    // then
    expect(gate.passed).toBe(true)
    expect(gate.provenance).toBe("tool")
  })
})
