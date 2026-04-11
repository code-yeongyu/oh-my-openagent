/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  reorderAgentsByPriority,
  CANONICAL_CORE_AGENT_ORDER,
} from "./agent-priority-order"
import { getAgentDisplayName, getAgentListDisplayName } from "../shared/agent-display-names"

describe("agent-priority-order", () => {
  describe("CANONICAL_CORE_AGENT_ORDER", () => {
    // given: The canonical order constant must exist and be correct

    test("exports canonical order as readonly array", () => {
      // then
      expect(CANONICAL_CORE_AGENT_ORDER).toBeDefined()
      expect(Array.isArray(CANONICAL_CORE_AGENT_ORDER)).toBe(true)
    })

    test("canonical order is exactly [sisyphus, hephaestus, prometheus, atlas]", () => {
      // then
      expect(CANONICAL_CORE_AGENT_ORDER).toEqual([
        "sisyphus",
        "hephaestus",
        "prometheus",
        "atlas",
      ])
    })

    test("canonical order length is exactly 4", () => {
      // then
      expect(CANONICAL_CORE_AGENT_ORDER).toHaveLength(4)
    })
  })

  describe("reorderAgentsByPriority", () => {
    // given: display names for all core agents
    const sisyphus = getAgentListDisplayName("sisyphus")
    const hephaestus = getAgentListDisplayName("hephaestus")
    const prometheus = getAgentListDisplayName("prometheus")
    const atlas = getAgentListDisplayName("atlas")
    const oracle = getAgentDisplayName("oracle")
    const librarian = getAgentDisplayName("librarian")
    const explore = getAgentDisplayName("explore")

    describe("#given agents in random order", () => {
      test("#when all core agents present #then orders as sisyphus→hephaestus→prometheus→atlas", () => {
        // given: agents in reverse order
        const agents: Record<string, unknown> = {
          [atlas]: { name: "atlas" },
          [prometheus]: { name: "prometheus" },
          [hephaestus]: { name: "hephaestus" },
          [sisyphus]: { name: "sisyphus" },
        }

        // when
        const result = reorderAgentsByPriority(agents)

        // then
        const keys = Object.keys(result)
        expect(keys[0]).toBe(sisyphus)
        expect(keys[1]).toBe(hephaestus)
        expect(keys[2]).toBe(prometheus)
        expect(keys[3]).toBe(atlas)
      })

      test("#when core agents mixed with non-core #then core agents come first in canonical order", () => {
        // given: mixed order with non-core agents interleaved
        const agents: Record<string, unknown> = {
          [oracle]: { name: "oracle" },
          [atlas]: { name: "atlas" },
          [librarian]: { name: "librarian" },
          [prometheus]: { name: "prometheus" },
          [explore]: { name: "explore" },
          [hephaestus]: { name: "hephaestus" },
          custom: { name: "custom" },
          [sisyphus]: { name: "sisyphus" },
        }

        // when
        const result = reorderAgentsByPriority(agents)

        // then
        const keys = Object.keys(result)
        expect(keys.slice(0, 4)).toEqual([sisyphus, hephaestus, prometheus, atlas])
      })
    })

    describe("#given 100 random permutations", () => {
      test("#when reordered #then result is ALWAYS identical", () => {
        // given: base agent config
        const baseAgents = {
          [sisyphus]: { name: "sisyphus" },
          [hephaestus]: { name: "hephaestus" },
          [prometheus]: { name: "prometheus" },
          [atlas]: { name: "atlas" },
          [oracle]: { name: "oracle" },
          [librarian]: { name: "librarian" },
          custom1: { name: "custom1" },
          custom2: { name: "custom2" },
        }

        // given: shuffle function
        const shuffle = <T>(array: T[]): T[] => {
          const result = [...array]
          for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[result[i], result[j]] = [result[j], result[i]]
          }
          return result
        }

        // when: run 100 times with different key orders
        const results: string[][] = []
        for (let i = 0; i < 100; i++) {
          const shuffledKeys = shuffle(Object.keys(baseAgents))
          const shuffledAgents: Record<string, unknown> = {}
          for (const key of shuffledKeys) {
            shuffledAgents[key] = baseAgents[key]
          }
          const result = reorderAgentsByPriority(shuffledAgents)
          results.push(Object.keys(result))
        }

        // then: all results should have identical key order
        const firstResult = results[0]
        for (let i = 1; i < results.length; i++) {
          expect(results[i]).toEqual(firstResult)
        }

        // then: core agents are always first 4 in canonical order
        expect(firstResult.slice(0, 4)).toEqual([
          sisyphus,
          hephaestus,
          prometheus,
          atlas,
        ])
      })
    })

    describe("#given partial core agents", () => {
      test("#when only sisyphus and atlas present #then orders as sisyphus→atlas", () => {
        // given
        const agents: Record<string, unknown> = {
          [atlas]: { name: "atlas" },
          custom: { name: "custom" },
          [sisyphus]: { name: "sisyphus" },
        }

        // when
        const result = reorderAgentsByPriority(agents)

        // then
        const keys = Object.keys(result)
        const sisyphusIdx = keys.indexOf(sisyphus)
        const atlasIdx = keys.indexOf(atlas)
        expect(sisyphusIdx).toBeLessThan(atlasIdx)
        expect(sisyphusIdx).toBe(0)
      })

      test("#when only hephaestus and prometheus present #then orders as hephaestus→prometheus", () => {
        // given
        const agents: Record<string, unknown> = {
          [prometheus]: { name: "prometheus" },
          custom: { name: "custom" },
          [hephaestus]: { name: "hephaestus" },
        }

        // when
        const result = reorderAgentsByPriority(agents)

        // then
        const keys = Object.keys(result)
        const hephaestusIdx = keys.indexOf(hephaestus)
        const prometheusIdx = keys.indexOf(prometheus)
        expect(hephaestusIdx).toBeLessThan(prometheusIdx)
        expect(hephaestusIdx).toBe(0)
      })
    })

    describe("#given order field injection", () => {
      test("#when core agent is object #then injects order field", () => {
        // given
        const agents: Record<string, unknown> = {
          [sisyphus]: { name: "sisyphus", mode: "primary" },
          [hephaestus]: { name: "hephaestus", mode: "primary" },
          [prometheus]: { name: "prometheus", mode: "all" },
          [atlas]: { name: "atlas", mode: "primary" },
        }

        // when
        const result = reorderAgentsByPriority(agents)

        // then
        expect(result[sisyphus]).toEqual({ name: "sisyphus", mode: "primary", order: 1 })
        expect(result[hephaestus]).toEqual({ name: "hephaestus", mode: "primary", order: 2 })
        expect(result[prometheus]).toEqual({ name: "prometheus", mode: "all", order: 3 })
        expect(result[atlas]).toEqual({ name: "atlas", mode: "primary", order: 4 })
      })

      test("#when core agent is non-object #then leaves value unchanged", () => {
        // given
        const agents: Record<string, unknown> = {
          [sisyphus]: "string-config",
          [atlas]: null,
        }

        // when
        const result = reorderAgentsByPriority(agents)

        // then
        expect(result[sisyphus]).toBe("string-config")
        expect(result[atlas]).toBe(null)
      })

      test("#when non-core agent #then does NOT inject order field", () => {
        // given
        const agents: Record<string, unknown> = {
          [oracle]: { name: "oracle", mode: "subagent" },
          custom: { name: "custom" },
        }

        // when
        const result = reorderAgentsByPriority(agents)

        // then
        expect(result[oracle]).toEqual({ name: "oracle", mode: "subagent" })
        expect(result.custom).toEqual({ name: "custom" })
      })
    })

    describe("#given non-core agent ordering", () => {
      test("#when multiple non-core agents #then sorted alphabetically after core agents", () => {
        // given: non-core agents in random order
        const agents: Record<string, unknown> = {
          zebra: { name: "zebra" },
          [sisyphus]: { name: "sisyphus" },
          apple: { name: "apple" },
          mango: { name: "mango" },
          [atlas]: { name: "atlas" },
        }

        // when
        const result = reorderAgentsByPriority(agents)

        // then: core agents first, then alphabetical
        const keys = Object.keys(result)
        expect(keys.slice(0, 2)).toEqual([sisyphus, atlas])
        expect(keys.slice(2)).toEqual(["apple", "mango", "zebra"])
      })
    })
  })
})
