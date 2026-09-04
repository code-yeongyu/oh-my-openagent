import { describe, expect, test } from "bun:test"

import {
  BUILTIN_AGENTS,
  BUILTIN_AGENT_DEFAULTS,
  CURATED_READONLY_AGENT_DEFAULTS,
  CURATED_READONLY_AGENT_NAMES,
  ULW_REVIEWER_AGENT_DEFAULTS,
  ULW_REVIEWER_AGENT_NAMES,
} from "./index"

const CURATED_AGENT_NAMES = ["explore", "librarian", "metis", "momus"] as const
const REVIEWER_AGENT_NAMES = ["omo-senpi-code-reviewer", "omo-senpi-gate-reviewer", "omo-senpi-qa-executor"] as const
const ALL_BUILTIN_NAMES = [...CURATED_AGENT_NAMES, ...REVIEWER_AGENT_NAMES].sort()

const EXPECTED_TOOL_ALLOWLIST = [
  "read",
  "find",
  "grep",
  "ls",
  "bash",
  "lsp_diagnostics",
  "lsp_goto_definition",
  "lsp_find_references",
  "lsp_symbols",
] as const

const EXPECTED_REVIEWER_TOOL_ALLOWLIST = [...EXPECTED_TOOL_ALLOWLIST, "write"] as const


describe("builtin curated agents", () => {
  test("#given the builtin defaults #when listing names sorted #then the 4 curated and 3 reviewer agents are present", () => {
    const names = BUILTIN_AGENT_DEFAULTS.map((definition) => definition.name).sort()
    expect(names).toEqual([...ALL_BUILTIN_NAMES])
  })

  test("#given the builtin record #when listing keys sorted #then every builtin maps to its definition", () => {
    expect(Object.keys(BUILTIN_AGENTS).sort()).toEqual([...ALL_BUILTIN_NAMES])
    for (const name of ALL_BUILTIN_NAMES) {
      expect(BUILTIN_AGENTS[name]?.name).toBe(name)
    }
  })

  test("#given the curated name set #when checking membership #then it contains exactly the 4 curated names", () => {
    expect(CURATED_READONLY_AGENT_NAMES.size).toBe(4)
    for (const name of CURATED_AGENT_NAMES) {
      expect(CURATED_READONLY_AGENT_NAMES.has(name)).toBe(true)
    }
  })

  test("#given the reviewer name set #when checking membership #then it contains exactly the 3 reviewer names and stays disjoint from the curated set", () => {
    expect(ULW_REVIEWER_AGENT_NAMES.size).toBe(3)
    for (const name of REVIEWER_AGENT_NAMES) {
      expect(ULW_REVIEWER_AGENT_NAMES.has(name)).toBe(true)
      expect(CURATED_READONLY_AGENT_NAMES.has(name)).toBe(false)
    }
  })

  test("#given every builtin definition #when inspecting shape #then mode is subagent and executionMode is pinned in-process", () => {
    for (const definition of BUILTIN_AGENT_DEFAULTS) {
      expect(definition.mode).toBe("subagent")
      expect(definition.executionMode).toBe("in-process")
    }
  })


  test("#given every curated definition #when inspecting tool rules #then exactly the 9 literal allow-true rules are present", () => {
    for (const definition of CURATED_READONLY_AGENT_DEFAULTS) {
      expect(definition.tools).toHaveLength(EXPECTED_TOOL_ALLOWLIST.length)
      const patterns = (definition.tools ?? []).map((rule) => rule.pattern)
      expect([...patterns].sort()).toEqual([...EXPECTED_TOOL_ALLOWLIST].sort())
      for (const rule of definition.tools ?? []) {
        expect(rule.allow).toBe(true)
      }
    }
  })

  test("#given every reviewer definition #when inspecting tool rules #then the curated allowlist plus write is present", () => {
    for (const definition of ULW_REVIEWER_AGENT_DEFAULTS) {
      expect(definition.tools).toHaveLength(EXPECTED_REVIEWER_TOOL_ALLOWLIST.length)
      const patterns = (definition.tools ?? []).map((rule) => rule.pattern)
      expect([...patterns].sort()).toEqual([...EXPECTED_REVIEWER_TOOL_ALLOWLIST].sort())
      for (const rule of definition.tools ?? []) {
        expect(rule.allow).toBe(true)
      }
    }
  })

  test("#given the reviewer definitions #when reading their names #then they match the ulw-loop omo-senpi quality-gate identities", () => {
    expect(ULW_REVIEWER_AGENT_DEFAULTS.map((definition) => definition.name)).toEqual([
      "omo-senpi-code-reviewer",
      "omo-senpi-qa-executor",
      "omo-senpi-gate-reviewer",
    ])
  })

  test("#given every builtin definition #when inspecting descriptions #then each is non-empty with the brand tag stripped", () => {
    for (const definition of BUILTIN_AGENT_DEFAULTS) {
      expect(typeof definition.description).toBe("string")
      expect(definition.description?.length).toBeGreaterThan(0)
      expect(definition.description).not.toContain("OhMyOpenCode")
      expect(definition.description).not.toContain("OhMyOpenAgent")
    }
  })
})
