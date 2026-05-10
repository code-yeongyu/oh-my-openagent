/// <reference types="bun-types" />

import { beforeAll, describe, expect, test } from "bun:test"

import {
  AGENT_DISPLAY_NAMES,
  getAgentListDisplayName,
  normalizeAgentForPromptKey,
} from "./agent-display-names"
import { installAgentSortShim } from "./agent-sort-shim"

type AgentListItem = {
  name: string
  default_agent?: boolean
}

function compareOpenCodeAgentListItems(left: AgentListItem, right: AgentListItem): number {
  const leftDefault = left.default_agent ? 1 : 0
  const rightDefault = right.default_agent ? 1 : 0
  if (leftDefault !== rightDefault) return rightDefault - leftDefault
  if (left.name < right.name) return -1
  if (left.name > right.name) return 1
  return 0
}

function simulateOpencodeSort(agentNames: string[], defaultName: string): string[] {
  const agents = agentNames.map((name): AgentListItem => ({
    name,
    default_agent: name === defaultName,
  }))

  return [...agents].sort(compareOpenCodeAgentListItems).map((agent) => agent.name)
}

describe("OpenCode Agent.list() sort with runtime display names", () => {
  beforeAll(() => {
    installAgentSortShim()
  })

  describe("#given the four core agents and a mix of non-core agents", () => {
    test("#when sorted using OpenCode-style ordering #then core agents come first in canonical order", () => {
      const sisyphus = getAgentListDisplayName("sisyphus")
      const hephaestus = getAgentListDisplayName("hephaestus")
      const prometheus = getAgentListDisplayName("prometheus")
      const atlas = getAgentListDisplayName("atlas")

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

    test("#when default_agent is unset #then canonical core order still holds via the sort shim", () => {
      const sisyphus = getAgentListDisplayName("sisyphus")
      const hephaestus = getAgentListDisplayName("hephaestus")
      const prometheus = getAgentListDisplayName("prometheus")
      const atlas = getAgentListDisplayName("atlas")

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

  describe("#given runtime names containing only core agents", () => {
    test("#when sorted #then sisyphus, hephaestus, prometheus, atlas in that order", () => {
      const sisyphus = getAgentListDisplayName("sisyphus")
      const hephaestus = getAgentListDisplayName("hephaestus")
      const prometheus = getAgentListDisplayName("prometheus")
      const atlas = getAgentListDisplayName("atlas")

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

  describe("#given runtime names are rendered", () => {
    test("#then they do not include invisible sort-prefix characters", () => {
      const runtimeNames = Object.keys(AGENT_DISPLAY_NAMES).map(getAgentListDisplayName)
      const invisibleCharsRegex = /[\u200B\u200C\u200D\uFEFF]/

      for (const name of runtimeNames) {
        expect(invisibleCharsRegex.test(name)).toBe(false)
      }
    })
  })
})
