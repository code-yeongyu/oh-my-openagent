import { describe, it, expect } from "bun:test"
import { THEMIS_IDENTITY_CONSTRAINTS } from "./identity-constraints"
import { buildThemisDefaultPrompt } from "./default"

describe("identity constraints", () => {
  it("#when constraint 11 present #then contains defer_recommended", () => {
    expect(THEMIS_IDENTITY_CONSTRAINTS).toContain("defer_recommended")
  })

  it("#when constraint 12 present #then contains converged_after_revision", () => {
    expect(THEMIS_IDENTITY_CONSTRAINTS).toContain("converged_after_revision")
  })

  it("#when constraint 13 present #then contains unable_to_converge", () => {
    expect(THEMIS_IDENTITY_CONSTRAINTS).toContain("unable_to_converge")
  })
})

describe("Themis charter", () => {
  it("#when built #then contains new response fields", () => {
    const prompt = buildThemisDefaultPrompt()
    expect(prompt).toContain("semantics_comparison")
    expect(prompt).toContain("epistemic_analysis")
    expect(prompt).toContain("audience_analysis")
    expect(prompt).toContain("confidence")
    expect(prompt).toContain("convergence")
  })

  it("#when built #then describes the richer response field semantics", () => {
    const prompt = buildThemisDefaultPrompt()
    expect(prompt).toContain("4 extension sets")
    expect(prompt).toContain("certainty gradient")
    expect(prompt).toContain("Piano A-D")
    expect(prompt).toContain("per-audience extensions")
    expect(prompt).toContain("framework_certainty")
    expect(prompt).toContain("world_certainty")
    expect(prompt).toContain("convergence status")
  })

  it("#when built #then documents the newer protocol pipeline steps", () => {
    const prompt = buildThemisDefaultPrompt()
    expect(prompt).toContain("multi-semantics comparison")
    expect(prompt).toContain("KB integration")
    expect(prompt).toContain("circuit breaker")
    expect(prompt).toContain("AGM revision")
  })
})
