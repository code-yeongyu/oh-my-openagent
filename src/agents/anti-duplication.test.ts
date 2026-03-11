/// <reference types="bun-types" />

import { describe, it, expect } from "bun:test"
import { buildAntiDuplicationSection } from "./dynamic-agent-prompt-builder"
import { METIS_SYSTEM_PROMPT } from "./metis"

describe("buildAntiDuplicationSection", () => {
  it("#given no arguments #when building anti-duplication section #then returns comprehensive rule section", () => {
    //#given: no special configuration needed

    //#when: building the anti-duplication section
    const result = buildAntiDuplicationSection()

    //#then: should contain the anti-duplication rule with all key concepts
    expect(result).toContain("Anti-Duplication Rule")
    expect(result).toContain("CRITICAL")
    expect(result).toContain("DO NOT perform the same search yourself")
  })

  it("#given no arguments #when building #then explicitly forbids manual re-search after delegation", () => {
    //#given: no special configuration

    //#when: building the section
    const result = buildAntiDuplicationSection()

    //#then: should explicitly list forbidden behaviors
    expect(result).toContain("FORBIDDEN")
    expect(result).toContain("manually grep/search for the same information")
    expect(result).toContain("Re-doing the research")
  })

  it("#given no arguments #when building #then allows non-overlapping work", () => {
    //#given: no special configuration

    //#when: building the section
    const result = buildAntiDuplicationSection()

    //#then: should explicitly allow non-overlapping work
    expect(result).toContain("ALLOWED")
    expect(result).toContain("non-overlapping work")
    expect(result).toContain("work that doesn't depend on the delegated research")
  })

  it("#given no arguments #when building #then includes wait-for-results instructions", () => {
    //#given: no special configuration

    //#when: building the section
    const result = buildAntiDuplicationSection()

    //#then: should include instructions for waiting properly
    expect(result).toContain("Wait for Results Properly")
    expect(result).toContain("End your response")
    expect(result).toContain("Wait for the completion notification")
    expect(result).toContain("background_output")
  })

  it("#given no arguments #when building #then explains why this matters", () => {
    //#given: no special configuration

    //#when: building the section
    const result = buildAntiDuplicationSection()

    //#then: should explain the purpose
    expect(result).toContain("Why This Matters")
    expect(result).toContain("Wasted tokens")
    expect(result).toContain("Confusion")
    expect(result).toContain("Efficiency")
  })

  it("#given no arguments #when building #then provides code examples", () => {
    //#given: no special configuration

    //#when: building the section
    const result = buildAntiDuplicationSection()

    //#then: should include examples
    expect(result).toContain("Example")
    expect(result).toContain("WRONG")
    expect(result).toContain("CORRECT")
    expect(result).toContain("task(subagent_type=")
  })

  it("#given no arguments #when building #then uses proper markdown formatting", () => {
    //#given: no special configuration

    //#when: building the section
    const result = buildAntiDuplicationSection()

    //#then: should be wrapped in Anti_Duplication tag
    expect(result).toContain("<Anti_Duplication>")
    expect(result).toContain("</Anti_Duplication>")
  })
})

describe("METIS_SYSTEM_PROMPT anti-duplication coverage", () => {
  it("#given the system prompt #when reading delegated exploration rules #then includes anti-duplication guidance", () => {
    // given
    const prompt = METIS_SYSTEM_PROMPT

    // when / then
    expect(prompt).toContain("<Anti_Duplication>")
    expect(prompt).toContain("Anti-Duplication Rule")
    expect(prompt).toContain("DO NOT perform the same search yourself")
    expect(prompt).toContain("non-overlapping work")
  })
})
