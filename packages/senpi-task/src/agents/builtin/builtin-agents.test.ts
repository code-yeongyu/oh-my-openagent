import { describe, expect, test } from "bun:test"

import { BUILTIN_AGENTS, BUILTIN_AGENT_DEFAULTS, CURATED_READONLY_AGENT_NAMES } from "./index"

const CURATED_AGENT_NAMES = ["explore", "librarian", "metis", "momus", "oracle"] as const

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

const FORBIDDEN_PROMPT_TOKENS = ["call_omo_agent", "background_output", "context7", "todowrite", "todoread"] as const

describe("builtin curated agents", () => {
  test("#given the builtin defaults #when listing names sorted #then exactly the 5 curated agents are present", () => {
    const names = BUILTIN_AGENT_DEFAULTS.map((definition) => definition.name).sort()
    expect(names).toEqual([...CURATED_AGENT_NAMES])
  })

  test("#given the builtin record #when listing keys sorted #then exactly the 5 curated agents are present and map to their definitions", () => {
    expect(Object.keys(BUILTIN_AGENTS).sort()).toEqual([...CURATED_AGENT_NAMES])
    for (const name of CURATED_AGENT_NAMES) {
      expect(BUILTIN_AGENTS[name]?.name).toBe(name)
    }
  })

  test("#given the curated name set #when checking membership #then it contains exactly the 5 curated names", () => {
    expect(CURATED_READONLY_AGENT_NAMES.size).toBe(5)
    for (const name of CURATED_AGENT_NAMES) {
      expect(CURATED_READONLY_AGENT_NAMES.has(name)).toBe(true)
    }
  })

  test("#given every builtin definition #when inspecting shape #then mode is subagent and executionMode is pinned in-process", () => {
    for (const definition of BUILTIN_AGENT_DEFAULTS) {
      expect(definition.mode).toBe("subagent")
      expect(definition.executionMode).toBe("in-process")
    }
  })

  test("#given every builtin definition #when inspecting prompts #then each is a non-empty string free of opencode-only tooling", () => {
    for (const definition of BUILTIN_AGENT_DEFAULTS) {
      expect(typeof definition.prompt).toBe("string")
      expect(definition.prompt?.length).toBeGreaterThan(0)
      for (const token of FORBIDDEN_PROMPT_TOKENS) {
        expect(definition.prompt).not.toContain(token)
      }
    }
  })

  test("#given every builtin definition #when inspecting tool rules #then exactly the 9 literal allow-true rules are present", () => {
    for (const definition of BUILTIN_AGENT_DEFAULTS) {
      expect(definition.tools).toHaveLength(EXPECTED_TOOL_ALLOWLIST.length)
      const patterns = (definition.tools ?? []).map((rule) => rule.pattern)
      expect([...patterns].sort()).toEqual([...EXPECTED_TOOL_ALLOWLIST].sort())
      for (const rule of definition.tools ?? []) {
        expect(rule.allow).toBe(true)
      }
    }
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
