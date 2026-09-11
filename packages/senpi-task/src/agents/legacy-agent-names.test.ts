import { describe, expect, test } from "bun:test"

import { LEGACY_AGENT_NAME_ALIASES, canonicalAgentName, legacyAgentNameNotice } from "./legacy-agent-names"

describe("canonicalAgentName", () => {
  test("#given a legacy curated id #when canonicalized #then the canonical id is returned with the legacy id recorded", () => {
    // when
    const momus = canonicalAgentName("momus")
    const metis = canonicalAgentName("metis")

    // then
    expect(momus).toEqual({ name: "plan-reviewer", legacy: "momus" })
    expect(metis).toEqual({ name: "plan-consultant", legacy: "metis" })
  })

  test("#given a canonical id #when canonicalized #then it is returned unchanged with no legacy", () => {
    // when
    const result = canonicalAgentName("plan-reviewer")

    // then
    expect(result).toEqual({ name: "plan-reviewer" })
    expect(result.legacy).toBeUndefined()
  })

  test("#given an unknown id #when canonicalized #then it passes through untouched", () => {
    // when
    const result = canonicalAgentName("explore")

    // then
    expect(result).toEqual({ name: "explore" })
  })

  test("#given surrounding whitespace #when canonicalized #then the name is trimmed before lookup", () => {
    // when / then
    expect(canonicalAgentName("  momus ")).toEqual({ name: "plan-reviewer", legacy: "momus" })
    expect(canonicalAgentName(" custom ")).toEqual({ name: "custom" })
  })

  test("#given a differently-cased legacy id #when canonicalized #then the lookup is exact-case and passes through", () => {
    // when / then
    expect(canonicalAgentName("Momus")).toEqual({ name: "Momus" })
  })

  test("#given the alias table #when read #then it maps exactly the two retired curated ids", () => {
    expect(LEGACY_AGENT_NAME_ALIASES).toEqual({ metis: "plan-consultant", momus: "plan-reviewer" })
  })

  test("#given the alias window #when the table keys are listed #then only metis and momus are aliased", () => {
    // Removal: delete the two aliases and this assertion in the release after the rename ships.
    expect(Object.keys(LEGACY_AGENT_NAME_ALIASES)).toEqual(["metis", "momus"])
  })
})

describe("legacyAgentNameNotice", () => {
  test("#given a legacy/canonical pair #when the notice is built #then it is the exact deprecation sentence", () => {
    expect(legacyAgentNameNotice("momus", "plan-reviewer")).toBe(
      'subagent_type "momus" is deprecated; use "plan-reviewer". The alias is removed in the next release.',
    )
  })
})
