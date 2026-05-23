/// <reference types="bun-types" />

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"

import {
  installAgentSortShim,
  setAgentSortOrder,
  setDefaultAgentForSort,
  sortAgentList,
} from "./agent-sort-shim"
import { AGENT_DISPLAY_NAMES } from "./agent-display-names"

type AgentListItem = {
  name: string
  default_agent?: boolean
}

describe("agent-sort-shim", () => {
  beforeAll(() => {
    // Confirms backwards compat: the shim install entry point is a no-op now.
    installAgentSortShim()
  })

  beforeEach(() => {
    setAgentSortOrder(undefined)
  })

  afterEach(() => {
    setAgentSortOrder(undefined)
  })

  describe("#given the global Array.prototype after the shim is installed", () => {
    test("#then Array.prototype.sort is the native implementation, not a patched copy", () => {
      // given a freshly installed (no-op) shim
      installAgentSortShim()

      // when reading the prototype descriptors
      const sortDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "sort")
      const toSortedDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted")

      // then the values must be the bun/node-provided natives and must not be writable
      // application-level overrides (writable is true natively, but the function source must be native).
      expect(typeof sortDescriptor?.value).toBe("function")
      expect(sortDescriptor?.value?.toString()).toContain("[native code]")
      // Some runtimes do not yet expose toSorted, so only validate when present.
      if (toSortedDescriptor) {
        expect(toSortedDescriptor.value?.toString()).toContain("[native code]")
      }
    })

    test("#then plain string arrays sort with native semantics", () => {
      // given
      const input = ["zebra", "apple", "mango"]

      // when
      const result = [...input].sort()

      // then
      expect(result).toEqual(["apple", "mango", "zebra"])
    })

    test("#then number arrays sort with native semantics", () => {
      // given
      const input = [3, 1, 4, 1, 5, 9, 2, 6]

      // when
      const result = input.sort((a, b) => a - b)

      // then native in-place sort returns the same reference
      expect(result).toBe(input)
      expect(input).toEqual([1, 1, 2, 3, 4, 5, 6, 9])
    })

    test("#then arrays whose elements happen to match agent names still sort with native semantics", () => {
      // given an array of objects that previously would have been re-ordered
      // by the global shim — under the scoped fix the prototype is untouched.
      const sisyphus = { name: "Sisyphus - ultraworker" }
      const hephaestus = { name: "Hephaestus - Deep Agent" }
      const prometheus = { name: "Prometheus - Plan Builder" }
      const atlas = { name: "Atlas - Plan Executor" }
      const input = [atlas, prometheus, hephaestus, sisyphus]

      // when calling the prototype-level toSorted directly
      const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

      // then ordering follows native alphabetical, NOT the canonical core order
      expect(result).toEqual([atlas, hephaestus, prometheus, sisyphus])
    })
  })

  describe("sortAgentList — scoped helper", () => {
    describe("#given an array of all 4 core agent objects in random order", () => {
      test("#when sorted with the scoped helper #then returns canonical sisyphus->hephaestus->prometheus->atlas order", () => {
        // given
        const sisyphus = { name: "Sisyphus - ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const input = [atlas, prometheus, hephaestus, sisyphus]

        // when
        const result = sortAgentList(input, (a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas])
      })

      test("#when configured order is non-default #then follows configured core agent order", () => {
        // given
        setAgentSortOrder(["hephaestus", "sisyphus", "prometheus", "atlas"])
        const sisyphus = { name: "Sisyphus - ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const input = [atlas, prometheus, hephaestus, sisyphus]

        // when
        const result = sortAgentList(input, (a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toEqual([hephaestus, sisyphus, prometheus, atlas])
      })
    })

    describe("#given 4 core agents mixed with 2 non-core agent objects", () => {
      test("#when sorted with the scoped helper #then core agents come first in canonical order followed by non-core agents alphabetically", () => {
        // given
        const sisyphus = { name: "Sisyphus - ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const build = { name: "build" }
        const plan = { name: "plan" }
        const input = [atlas, build, prometheus, plan, hephaestus, sisyphus]

        // when
        const result = sortAgentList(input, (a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas, build, plan])
      })
    })

    describe("#given OpenCode Agent.list style sort with default agent priority", () => {
      test("#when sortAgentList honors default_agent first and then name #then core agents stay in canonical order", () => {
        // given
        const sisyphus = { name: AGENT_DISPLAY_NAMES.sisyphus, default_agent: true }
        const hephaestus = { name: AGENT_DISPLAY_NAMES.hephaestus }
        const prometheus = { name: AGENT_DISPLAY_NAMES.prometheus }
        const atlas = { name: AGENT_DISPLAY_NAMES.atlas }
        const oracle = { name: AGENT_DISPLAY_NAMES.oracle }
        const explore = { name: AGENT_DISPLAY_NAMES.explore }
        const input: AgentListItem[] = [oracle, atlas, explore, prometheus, hephaestus, sisyphus]

        // when
        const result = sortAgentList(input, (left, right) => {
          const leftDefault = left.default_agent ? 1 : 0
          const rightDefault = right.default_agent ? 1 : 0
          if (leftDefault !== rightDefault) return rightDefault - leftDefault
          return left.name.localeCompare(right.name)
        })

        // then
        expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas, explore, oracle])
      })
    })

    describe("#given an array with only one core agent and several non-core agent-like objects", () => {
      test("#when sortAgentList is called #then activation predicate fails and result follows native compareFn ordering", () => {
        // given
        const oracle = { name: "oracle" }
        const librarian = { name: "librarian" }
        const sisyphus = { name: "Sisyphus - ultraworker" }
        const explore = { name: "explore" }
        const input = [oracle, librarian, sisyphus, explore]

        // when
        const result = sortAgentList(input, (a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        )

        // then — ASCII-sensitive, capital S sorts before lowercase letters
        expect(result).toEqual([sisyphus, explore, librarian, oracle])
      })
    })

    describe("#given a mixed-type array containing null, objects, a string, and a number", () => {
      test("#when sortAgentList runs with a string-coercing compareFn #then activation predicate fails, helper does not throw, and result matches native semantics", () => {
        // given
        const sisyphusObj = { name: "Sisyphus - ultraworker" }
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
        const result = sortAgentList(input, compare)

        // then
        expect(result).toEqual([42, sisyphusObj, hephaestusObj, null, "string"])
      })
    })

    describe("#given a plain string array", () => {
      test("#when sortAgentList runs with no compareFn #then returns native alphabetical ordering untouched", () => {
        // given
        const input = ["zebra", "apple", "mango"]

        // when
        const result = sortAgentList(input)

        // then
        expect(result).toEqual(["apple", "mango", "zebra"])
      })
    })

    describe("#given installAgentSortShim has been invoked multiple times", () => {
      test("#when sortAgentList is called after duplicate installs #then result is canonical order with no double-wrapping side effects", () => {
        // given
        installAgentSortShim()
        installAgentSortShim()
        const sisyphus = { name: "Sisyphus - ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const input = [atlas, prometheus, hephaestus, sisyphus]

        // when
        const result = sortAgentList(input, (a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas])
      })
    })

    describe("#given a custom default_agent configured via setDefaultAgentForSort", () => {
      test("#when sortAgentList is called on core agents mixed with the custom default agent #then the custom default agent sorts first, followed by core agents in canonical order", () => {
        // given
        setAgentSortOrder(undefined)
        setDefaultAgentForSort("crystal")
        const sisyphus = { name: "Sisyphus - ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const crystal = { name: "crystal" }
        const input = [atlas, crystal, prometheus, hephaestus, sisyphus]

        // when
        const result = sortAgentList(input, (a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toEqual([crystal, sisyphus, hephaestus, prometheus, atlas])
      })

      test("#when setDefaultAgentForSort is called with a core agent name #then that core agent sorts first, others follow in remaining canonical order", () => {
        // given
        setAgentSortOrder(undefined)
        setDefaultAgentForSort("Hephaestus - Deep Agent")
        const sisyphus = { name: "Sisyphus - ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const input = [atlas, prometheus, hephaestus, sisyphus]

        // when
        const result = sortAgentList(input, (a, b) => a.name.localeCompare(b.name))

        // then
        expect(result).toEqual([hephaestus, sisyphus, prometheus, atlas])
      })
    })

    describe("#given agent_order configured without default_agent", () => {
      test("#when setAgentSortOrder sets a non-canonical order and setDefaultAgentForSort is NOT called #then the custom agent_order is preserved without implicit override", () => {
        // given
        setAgentSortOrder(["hephaestus", "sisyphus", "prometheus", "atlas"])
        // setDefaultAgentForSort is intentionally NOT called (user did not set default_agent)
        const sisyphus = { name: "Sisyphus - ultraworker" }
        const hephaestus = { name: "Hephaestus - Deep Agent" }
        const prometheus = { name: "Prometheus - Plan Builder" }
        const atlas = { name: "Atlas - Plan Executor" }
        const input = [atlas, sisyphus, prometheus, hephaestus]

        // when
        const result = sortAgentList(input, (a, b) => a.name.localeCompare(b.name))

        // then — Hephaestus must remain first per the user's agent_order
        expect(result).toEqual([hephaestus, sisyphus, prometheus, atlas])
      })
    })
  })
})
