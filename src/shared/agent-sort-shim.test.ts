import { describe, it, expect, beforeAll } from "bun:test"
import { installAgentSortShim } from "./agent-sort-shim"

beforeAll(() => {
  installAgentSortShim()
})

describe("installAgentSortShim", () => {
  it("#given agent objects with known names #when toSorted with name comparator #then returns priority order", () => {
    const agents = [
      { name: "Atlas - Plan Executor", native: false },
      { name: "Prometheus - Plan Builder", native: false },
      { name: "Hephaestus - Deep Agent", native: false },
      { name: "Sisyphus - Ultraworker", native: false },
    ]

    const sorted = agents.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    expect(sorted.map((a) => a.name)).toEqual([
      "Sisyphus - Ultraworker",
      "Hephaestus - Deep Agent",
      "Prometheus - Plan Builder",
      "Atlas - Plan Executor",
    ])
  })

  it("#given mixed known and unknown agents #when toSorted #then ranked agents first then unknowns by fallback", () => {
    const agents = [
      { name: "build", native: true },
      { name: "Atlas - Plan Executor", native: false },
      { name: "Sisyphus - Ultraworker", native: false },
      { name: "plan", native: true },
    ]

    const sorted = agents.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    expect(sorted.map((a) => a.name)).toEqual([
      "Sisyphus - Ultraworker",
      "Atlas - Plan Executor",
      "build",
      "plan",
    ])
  })

  it("#given plain string array #when toSorted #then not intercepted", () => {
    const strs = ["zebra", "apple", "mango"]

    const sorted = strs.toSorted()

    expect(sorted).toEqual(["apple", "mango", "zebra"])
  })

  it("#given agent objects #when sort (in-place) #then also applies priority order", () => {
    const agents = [
      { name: "Atlas - Plan Executor" },
      { name: "Sisyphus - Ultraworker" },
      { name: "Hephaestus - Deep Agent" },
    ]

    agents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

    expect(agents.map((a) => a.name)).toEqual([
      "Sisyphus - Ultraworker",
      "Hephaestus - Deep Agent",
      "Atlas - Plan Executor",
    ])
  })

  it("#given number array #when sort #then not intercepted", () => {
    const nums = [3, 1, 2]

    nums.sort((a, b) => a - b)

    expect(nums).toEqual([1, 2, 3])
  })
})
