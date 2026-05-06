/// <reference types="bun-types" />

import { beforeAll, describe, expect, test } from "bun:test"

import { installAgentSortShim } from "./agent-sort-shim"
import { AGENT_DISPLAY_NAMES } from "./agent-display-names"

type AgentListItem = {
  name: string
  default_agent?: boolean
}

describe("agent-sort-shim", () => {
  beforeAll(() => {
    installAgentSortShim()
  })

  describe("#given an array of all 4 core agent objects in random order", () => {
    describe("#when toSorted with alphabetical compareFn", () => {
      test("#then returns canonical sisyphus->hephaestus->prometheus->atlas order", () => {
        // given
        const sisyphus = { name: "Sisyphus - Ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const input = [atlas, prometheus, hephaestus, sisyphus]

        // when
        const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas])
      })
    })
  })

  describe("#given 4 core agents mixed with 2 non-core agent objects", () => {
    describe("#when toSorted with alphabetical compareFn", () => {
      test("#then core agents come first in canonical order followed by non-core agents alphabetically", () => {
        // given
        const sisyphus = { name: "Sisyphus - Ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const build = { name: "build" }
        const plan = { name: "plan" }
        const input = [atlas, build, prometheus, plan, hephaestus, sisyphus]

        // when
        const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas, build, plan])
      })
    })
  })

  describe("#given OpenCode Agent.list style sort with default agent priority", () => {
    describe("#when toSorted compares default_agent first and then name", () => {
      test("#then core agents stay in canonical order before non-core agents", () => {
        // given
        const sisyphus = { name: AGENT_DISPLAY_NAMES.sisyphus, default_agent: true }
        const hephaestus = { name: AGENT_DISPLAY_NAMES.hephaestus }
        const prometheus = { name: AGENT_DISPLAY_NAMES.prometheus }
        const atlas = { name: AGENT_DISPLAY_NAMES.atlas }
        const oracle = { name: AGENT_DISPLAY_NAMES.oracle }
        const explore = { name: AGENT_DISPLAY_NAMES.explore }
        const input: AgentListItem[] = [oracle, atlas, explore, prometheus, hephaestus, sisyphus]

        // when
        const result = input.toSorted((left, right) => {
          const leftDefault = left.default_agent ? 1 : 0
          const rightDefault = right.default_agent ? 1 : 0
          if (leftDefault !== rightDefault) return rightDefault - leftDefault
          return left.name.localeCompare(right.name)
        })

        // then
        expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas, explore, oracle])
      })
    })
  })

  describe("#given an array with only one core agent and several non-core agent-like objects", () => {
    describe("#when toSorted with case-sensitive string-comparison compareFn", () => {
      test("#then activation predicate fails and result is ASCII-sensitive order with capital S before lowercase letters", () => {
        // given
        const oracle = { name: "oracle" }
        const librarian = { name: "librarian" }
        const sisyphus = { name: "Sisyphus - Ultraworker" }
        const explore = { name: "explore" }
        const input = [oracle, librarian, sisyphus, explore]

        // when
        const result = input.toSorted((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        )

        // then
        expect(result).toEqual([sisyphus, explore, librarian, oracle])
      })
    })
  })

  describe("#given a mixed-type array containing null, objects, a string, and a number", () => {
    describe("#when toSorted with a string-coercing compareFn", () => {
      test("#then activation predicate fails, shim does not throw, and result matches native semantics", () => {
        // given
        const sisyphusObj = { name: "Sisyphus - Ultraworker" }
        const hephaestusObj = { name: "Hephaestus - Deep Agent" }
        const input: unknown[] = [null, sisyphusObj, "string", 42, hephaestusObj]
        const compare = (a: unknown, b: unknown): number => {
          const sa = String(a)
          const sb = String(b)
          if (sa < sb) return -1
          if (sa > sb) return 1
          return 0
        }

        // when
        const result = input.toSorted(compare)

        // then
        expect(result).toEqual([42, sisyphusObj, hephaestusObj, null, "string"])
      })
    })
  })

  describe("#given a plain string array", () => {
    describe("#when toSorted with no compareFn", () => {
      test("#then returns native alphabetical ordering untouched", () => {
        // given
        const input = ["zebra", "apple", "mango"]

        // when
        const result = input.toSorted()

        // then
        expect(result).toEqual(["apple", "mango", "zebra"])
      })
    })
  })

  describe("#given a number array", () => {
    describe("#when sort with numeric compareFn (in-place)", () => {
      test("#then mutates the array and returns the same reference in ascending order", () => {
        // given
        const input = [3, 1, 4, 1, 5, 9, 2, 6]

        // when
        const result = input.sort((a, b) => a - b)

        // then
        expect(result).toBe(input)
        expect(input).toEqual([1, 1, 2, 3, 4, 5, 6, 9])
      })
    })
  })

  describe("#given agent objects with all 4 core display names in random order", () => {
    describe("#when sort with alphabetical compareFn (in-place)", () => {
      test("#then mutates the original array to canonical order", () => {
        // given
        const sisyphus = { name: "Sisyphus - Ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const input = [atlas, prometheus, hephaestus, sisyphus]

        // when
        const result = input.sort((a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toBe(input)
        expect(input).toEqual([sisyphus, hephaestus, prometheus, atlas])
      })
    })
  })

  describe("#given installAgentSortShim has been invoked multiple times", () => {
    describe("#when toSorted is called on core agents after duplicate installs", () => {
      test("#then result is canonical order with no double-wrapping side effects", () => {
        // given
        installAgentSortShim()
        installAgentSortShim()
        const sisyphus = { name: "Sisyphus - Ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const input = [atlas, prometheus, hephaestus, sisyphus]

        // when
        const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas])
      })
    })
  })
})
