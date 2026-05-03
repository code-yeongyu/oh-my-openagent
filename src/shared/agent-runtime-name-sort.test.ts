/// <reference types="bun-types" />

import { describe, expect, it, test } from "bun:test"

import {
  AGENT_DISPLAY_NAMES,
  getAgentRuntimeName,
  normalizeAgentForPromptKey,
} from "./agent-display-names"

// OpenCode Agent.list() sorts via remeda sortBy: default_agent desc, then name asc localeCompare.
// Reference: ../opencode/packages/opencode/src/agent/agent.ts:284-293.
// Earlier ZWSP prefixes silently failed: Unicode collation treats zero-width chars as ignorable.
function simulateOpencodeSort(agentNames: string[], defaultName: string): string[] {
  return [...agentNames].sort((a, b) => {
    const aIsDefault = a === defaultName ? 1 : 0
    const bIsDefault = b === defaultName ? 1 : 0
    if (aIsDefault !== bIsDefault) return bIsDefault - aIsDefault
    return a.localeCompare(b)
  })
}

describe("OpenCode Agent.list() sort with runtime-name prefixes", () => {
  describe("#given the four core agents and a mix of non-core agents", () => {
    test("#when sorted using opencode-style sortBy #then core agents come first in canonical order", () => {
      const sisyphus = getAgentRuntimeName("sisyphus")
      const hephaestus = getAgentRuntimeName("hephaestus")
      const prometheus = getAgentRuntimeName("prometheus")
      const atlas = getAgentRuntimeName("atlas")

      const allAgents = [
        sisyphus,
        hephaestus,
        prometheus,
        atlas,
        "athena",
        "explore",
        "metis",
        "oracle",
      ]

      const sorted = simulateOpencodeSort(allAgents, sisyphus)
      const orderedConfigKeys = sorted.map((name) => normalizeAgentForPromptKey(name))

      expect(orderedConfigKeys).toEqual([
        "sisyphus",
        "hephaestus",
        "prometheus",
        "atlas",
        "athena",
        "explore",
        "metis",
        "oracle",
      ])
    })

    test("#when default_agent is unset #then canonical core order still holds via prefix alone", () => {
      const sisyphus = getAgentRuntimeName("sisyphus")
      const hephaestus = getAgentRuntimeName("hephaestus")
      const prometheus = getAgentRuntimeName("prometheus")
      const atlas = getAgentRuntimeName("atlas")

      const allAgents = [hephaestus, prometheus, atlas, sisyphus, "athena", "oracle"]

      const sorted = simulateOpencodeSort(allAgents, "no-such-default-agent")
      const orderedConfigKeys = sorted.map((name) => normalizeAgentForPromptKey(name))

      expect(orderedConfigKeys.slice(0, 4)).toEqual([
        "sisyphus",
        "hephaestus",
        "prometheus",
        "atlas",
      ])
    })
  })

  describe("#given input array in random order", () => {
    test("#when sorted with opencode comparator #then result is always canonical", () => {
      const sisyphus = getAgentRuntimeName("sisyphus")
      const hephaestus = getAgentRuntimeName("hephaestus")
      const prometheus = getAgentRuntimeName("prometheus")
      const atlas = getAgentRuntimeName("atlas")
      const nonCore = ["athena", "explore", "librarian", "metis", "oracle"]
      const allAgents = [...nonCore, atlas, prometheus, hephaestus, sisyphus]

      for (let attempt = 0; attempt < 25; attempt += 1) {
        const shuffled = [...allAgents]
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
        }
        const sorted = simulateOpencodeSort(shuffled, sisyphus)
        const orderedConfigKeys = sorted.map((name) => normalizeAgentForPromptKey(name))

        expect(orderedConfigKeys).toEqual([
          "sisyphus",
          "hephaestus",
          "prometheus",
          "atlas",
          "athena",
          "explore",
          "librarian",
          "metis",
          "oracle",
        ])
      }
    })
  })

  describe("#given runtime names containing only core agents", () => {
    test("#when sorted #then sisyphus, hephaestus, prometheus, atlas in that order", () => {
      const sisyphus = getAgentRuntimeName("sisyphus")
      const hephaestus = getAgentRuntimeName("hephaestus")
      const prometheus = getAgentRuntimeName("prometheus")
      const atlas = getAgentRuntimeName("atlas")

      const sorted = simulateOpencodeSort([atlas, prometheus, hephaestus, sisyphus], sisyphus)
      const orderedConfigKeys = sorted.map((name) => normalizeAgentForPromptKey(name))

      expect(orderedConfigKeys).toEqual([
        "sisyphus",
        "hephaestus",
        "prometheus",
        "atlas",
      ])
    })
  })

  describe("#given the prefix is meant to render in OpenCode TUI", () => {
    it("uses ASCII whitespace so terminals render the prefix without character corruption", () => {
      const runtimeNames = Object.keys(AGENT_DISPLAY_NAMES).map(getAgentRuntimeName)
      const invisibleCharsRegex = /[\u200B\u200C\u200D\uFEFF]/

      for (const name of runtimeNames) {
        expect(invisibleCharsRegex.test(name)).toBe(false)
      }
    })

    it("only adds leading whitespace, never trailing or interior whitespace beyond the display name", () => {
      const sisyphus = getAgentRuntimeName("sisyphus")
      const hephaestus = getAgentRuntimeName("hephaestus")
      const prometheus = getAgentRuntimeName("prometheus")
      const atlas = getAgentRuntimeName("atlas")

      for (const name of [sisyphus, hephaestus, prometheus, atlas]) {
        const trimmed = name.trimStart()
        expect(name.length).toBeGreaterThanOrEqual(trimmed.length)
        expect(trimmed.endsWith(" ")).toBe(false)
      }
    })
  })
})
