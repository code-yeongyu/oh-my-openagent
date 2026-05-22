/// <reference types="bun-types" />

import { afterEach, beforeAll, describe, expect, test } from "bun:test"

import { installAgentSortShim, setAgentSortOrder, setDefaultAgentForSort } from "./agent-sort-shim"
import { AGENT_DISPLAY_NAMES } from "./agent-display-names"

type AgentListItem = {
  name: string
  default_agent?: boolean
}

describe("agent-sort-shim", () => {
  beforeAll(() => {
    installAgentSortShim()
  })

  afterEach(() => {
    setAgentSortOrder(undefined)
  })

  test("returns canonical order for core agents", () => {
    setAgentSortOrder(undefined)
    const sisyphus = { name: "Sisyphus - ultraworker" }
    const hephaestus = { name: "Hephaestus - Deep Agent" }
    const prometheus = { name: "Prometheus - Plan Builder" }
    const atlas = { name: "Atlas - Plan Executor" }
    const input = [atlas, prometheus, hephaestus, sisyphus]

    const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

    expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas])
  })

  test("follows configured core agent order", () => {
    setAgentSortOrder(["hephaestus", "sisyphus", "prometheus", "atlas"])
    const sisyphus = { name: "Sisyphus - ultraworker" }
    const hephaestus = { name: "Hephaestus - Deep Agent" }
    const prometheus = { name: "Prometheus - Plan Builder" }
    const atlas = { name: "Atlas - Plan Executor" }
    const input = [atlas, prometheus, hephaestus, sisyphus]

    const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

    expect(result).toEqual([hephaestus, sisyphus, prometheus, atlas])
  })

  test("core agents come first followed by non-core agents alphabetically", () => {
    const sisyphus = { name: "Sisyphus - ultraworker" }
    const hephaestus = { name: "Hephaestus - Deep Agent" }
    const prometheus = { name: "Prometheus - Plan Builder" }
    const atlas = { name: "Atlas - Plan Executor" }
    const build = { name: "build" }
    const plan = { name: "plan" }
    const input = [atlas, build, prometheus, plan, hephaestus, sisyphus]

    const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

    expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas, build, plan])
  })

  test("core agents stay in canonical order before non-core agents with default_agent", () => {
    const sisyphus = { name: AGENT_DISPLAY_NAMES.sisyphus, default_agent: true }
    const hephaestus = { name: AGENT_DISPLAY_NAMES.hephaestus }
    const prometheus = { name: AGENT_DISPLAY_NAMES.prometheus }
    const atlas = { name: AGENT_DISPLAY_NAMES.atlas }
    const oracle = { name: AGENT_DISPLAY_NAMES.oracle }
    const explore = { name: AGENT_DISPLAY_NAMES.explore }
    const input: AgentListItem[] = [oracle, atlas, explore, prometheus, hephaestus, sisyphus]

    const result = input.toSorted((left, right) => {
      const leftDefault = left.default_agent ? 1 : 0
      const rightDefault = right.default_agent ? 1 : 0
      if (leftDefault !== rightDefault) return rightDefault - leftDefault
      return left.name.localeCompare(right.name)
    })

    expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas, explore, oracle])
  })

  test("activation predicate fails for single core agent with non-core agents", () => {
    const oracle = { name: "oracle" }
    const librarian = { name: "librarian" }
    const sisyphus = { name: "Sisyphus - ultraworker" }
    const explore = { name: "explore" }
    const input = [oracle, librarian, sisyphus, explore]

    const result = input.toSorted((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )

    expect(result).toEqual([sisyphus, explore, librarian, oracle])
  })

  test("shim does not throw on mixed-type arrays", () => {
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

    const result = input.toSorted(compare)

    expect(result).toEqual([42, sisyphusObj, hephaestusObj, null, "string"])
  })

  test("returns native alphabetical ordering for plain string arrays", () => {
    const input = ["zebra", "apple", "mango"]

    const result = input.toSorted()

    expect(result).toEqual(["apple", "mango", "zebra"])
  })

  test("mutates the array and returns the same reference for sort", () => {
    const input = [3, 1, 4, 1, 5, 9, 2, 6]

    const result = input.sort((a, b) => a - b)

    expect(result).toBe(input)
    expect(input).toEqual([1, 1, 2, 3, 4, 5, 6, 9])
  })

  test("mutates the original array to canonical order for in-place sort", () => {
    const sisyphus = { name: "Sisyphus - ultraworker" }
    const hephaestus = { name: "Hephaestus - Deep Agent" }
    const prometheus = { name: "Prometheus - Plan Builder" }
    const atlas = { name: "Atlas - Plan Executor" }
    const input = [atlas, prometheus, hephaestus, sisyphus]

    const result = input.sort((a, b) => a.name.localeCompare(b.name))

    expect(result).toBe(input)
    expect(input).toEqual([sisyphus, hephaestus, prometheus, atlas])
  })

  test("no double-wrapping side effects after duplicate installs", () => {
    installAgentSortShim()
    installAgentSortShim()
    const sisyphus = { name: "Sisyphus - ultraworker" }
    const hephaestus = { name: "Hephaestus - Deep Agent" }
    const prometheus = { name: "Prometheus - Plan Builder" }
    const atlas = { name: "Atlas - Plan Executor" }
    const input = [atlas, prometheus, hephaestus, sisyphus]

    const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

    expect(result).toEqual([sisyphus, hephaestus, prometheus, atlas])
  })

  test("custom default agent sorts first", () => {
    setAgentSortOrder(undefined)
    setDefaultAgentForSort("crystal")
    const sisyphus = { name: "Sisyphus - ultraworker" }
    const hephaestus = { name: "Hephaestus - Deep Agent" }
    const prometheus = { name: "Prometheus - Plan Builder" }
    const atlas = { name: "Atlas - Plan Executor" }
    const crystal = { name: "crystal" }
    const input = [atlas, crystal, prometheus, hephaestus, sisyphus]

    const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

    expect(result).toEqual([crystal, sisyphus, hephaestus, prometheus, atlas])
  })

  test("core agent set as default sorts first", () => {
    setAgentSortOrder(undefined)
    setDefaultAgentForSort("Hephaestus - Deep Agent")
    const sisyphus = { name: "Sisyphus - ultraworker" }
    const hephaestus = { name: "Hephaestus - Deep Agent" }
    const prometheus = { name: "Prometheus - Plan Builder" }
    const atlas = { name: "Atlas - Plan Executor" }
    const input = [atlas, prometheus, hephaestus, sisyphus]

    const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

    expect(result).toEqual([hephaestus, sisyphus, prometheus, atlas])
  })

  test("custom agent_order is preserved without implicit override", () => {
    setAgentSortOrder(["hephaestus", "sisyphus", "prometheus", "atlas"])
    const sisyphus = { name: "Sisyphus - ultraworker" }
    const hephaestus = { name: "Hephaestus - Deep Agent" }
    const prometheus = { name: "Prometheus - Plan Builder" }
    const atlas = { name: "Atlas - Plan Executor" }
    const input = [atlas, sisyphus, prometheus, hephaestus]

    const result = input.toSorted((a, b) => a.name.localeCompare(b.name))

    expect(result).toEqual([hephaestus, sisyphus, prometheus, atlas])
  })
})
