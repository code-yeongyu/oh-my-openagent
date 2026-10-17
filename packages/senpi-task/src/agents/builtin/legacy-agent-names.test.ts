import { describe, expect, test } from "bun:test"

import { resolveAgent } from "../resolve-agent"
import { BUILTIN_AGENTS, ULW_REVIEWER_AGENT_NAMES } from "./index"
import { canonicalAgentName, LEGACY_AGENT_NAME_ALIASES } from "./legacy-agent-names"

const RENAMED_REVIEWERS = [
  ["omo-senpi-code-reviewer", "omo-native-code-reviewer"],
  ["omo-senpi-qa-executor", "omo-native-qa-executor"],
  ["omo-senpi-gate-reviewer", "omo-native-gate-reviewer"],
] as const

describe("canonicalAgentName", () => {
  test("#given a retired omo-senpi reviewer name #when canonicalized #then it becomes the omo-native name", () => {
    for (const [legacy, canonical] of RENAMED_REVIEWERS) {
      expect(canonicalAgentName(legacy)).toBe(canonical)
    }
  })

  test("#given a live agent name #when canonicalized #then it is returned unchanged", () => {
    for (const name of ["explore", "librarian", "omo-native-code-reviewer", "my-own-agent"]) {
      expect(canonicalAgentName(name)).toBe(name)
    }
  })

  test("#given the alias map #when read #then every legacy name points at a builtin agent", () => {
    for (const canonical of Object.values(LEGACY_AGENT_NAME_ALIASES)) {
      expect(Object.hasOwn(BUILTIN_AGENTS, canonical)).toBe(true)
    }
  })
})

describe("the renamed ulw-loop reviewer trio", () => {
  test("#given the builtin agents #when listed #then the reviewers carry the omo-native names only", () => {
    expect([...ULW_REVIEWER_AGENT_NAMES].sort()).toEqual([
      "omo-native-code-reviewer",
      "omo-native-gate-reviewer",
      "omo-native-qa-executor",
    ])
    for (const [legacy, canonical] of RENAMED_REVIEWERS) {
      expect(Object.hasOwn(BUILTIN_AGENTS, canonical)).toBe(true)
      expect(Object.hasOwn(BUILTIN_AGENTS, legacy)).toBe(false)
    }
  })

  test("#given a delegation still naming an omo-senpi reviewer #when resolved #then it reaches the renamed agent", () => {
    for (const [legacy, canonical] of RENAMED_REVIEWERS) {
      // given / when
      const resolution = resolveAgent(legacy, BUILTIN_AGENTS, undefined)

      // then
      expect(resolution.kind).not.toBe("not_found")
      expect(resolution.agent).toBe(canonical)
    }
  })

  test("#given a delegation naming the renamed agent #when resolved #then it resolves to itself", () => {
    for (const [, canonical] of RENAMED_REVIEWERS) {
      const resolution = resolveAgent(canonical, BUILTIN_AGENTS, undefined)

      expect(resolution.kind).not.toBe("not_found")
      expect(resolution.agent).toBe(canonical)
    }
  })

  test("#given a name that matches no agent #when resolved #then it is still reported as not found", () => {
    expect(resolveAgent("omo-senpi-nonexistent", BUILTIN_AGENTS, undefined).kind).toBe("not_found")
  })
})
