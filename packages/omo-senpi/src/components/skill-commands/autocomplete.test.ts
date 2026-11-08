import { describe, expect, test } from "bun:test"

import {
  type AutocompleteItemLike,
  type AutocompleteProviderLike,
  type AutocompleteSuggestionsLike,
  wrapWithBareSkillCommands,
} from "./autocomplete"

const NAMES = new Set(["ulw-execute", "ulw-plan", "ulw-research", "init-deep"])
const COMMANDS = [
  { name: "skill:ulw-execute", description: "Executes a work plan.", source: "skill" },
  { name: "skill:ulw-plan", description: "Plans first.", source: "skill" },
  { name: "skill:init-deep", source: "skill" },
  { name: "init", source: "extension" },
]

class FakeProvider implements AutocompleteProviderLike {
  readonly triggerCharacters = ["$"]
  applied: unknown[] = []
  constructor(private readonly result: AutocompleteSuggestionsLike | null) {}
  async getSuggestions(..._request: Parameters<AutocompleteProviderLike["getSuggestions"]>): Promise<AutocompleteSuggestionsLike | null> {
    return this.result
  }
  applyCompletion(...args: unknown[]): string {
    this.applied.push(args)
    return "applied-by-base"
  }
}

const signal = new AbortController().signal
const values = (items: readonly AutocompleteItemLike[] | undefined): string[] => (items ?? []).map((item) => item.value)

describe("bare skill command autocomplete", () => {
  test("#given senpi lists skill:<name> rows #when the user types /ulw #then each loaded skill is one row, its bare alias in its skill row's place (#9648)", async () => {
    const base = new FakeProvider({
      prefix: "/ulw",
      items: [{ value: "skill:ulw-execute", label: "skill:ulw-execute" }, { value: "settings", label: "settings" }, { value: "skill:ulw-plan", label: "skill:ulw-plan" }],
    })
    const wrapped = wrapWithBareSkillCommands(base, NAMES, () => COMMANDS)

    const result = await wrapped.getSuggestions(["/ulw"], 0, 4, { signal })

    expect(result?.prefix).toBe("/ulw")
    expect(values(result?.items)).toEqual(["ulw-execute", "settings", "ulw-plan"])
    expect(result?.items[0]?.description).toBe("Executes a work plan.")
  })

  test("#given a same-named command shadows a skill's bare name #when the user types /init #then that skill keeps its skill:<name> row, the only way to reach it (#9648)", async () => {
    const base = new FakeProvider({
      prefix: "/init",
      items: [{ value: "init", label: "init" }, { value: "skill:init", label: "skill:init" }, { value: "skill:init-deep", label: "skill:init-deep" }],
    })
    const shadowed = new Set(["init"])
    const wrapped = wrapWithBareSkillCommands(base, shadowed, () => [...COMMANDS, { name: "skill:init", source: "skill" }])

    const result = await wrapped.getSuggestions(["/init"], 0, 5, { signal })

    expect(values(result?.items)).toEqual(["init", "skill:init", "skill:init-deep"])
  })

  test("#given the user types /skill: #when suggestions are requested #then senpi's skill:<name> list is returned unchanged (#9648)", async () => {
    const page = { prefix: "/skill:", items: [{ value: "skill:ulw-execute", label: "skill:ulw-execute" }, { value: "skill:ulw-plan", label: "skill:ulw-plan" }] }
    const wrapped = wrapWithBareSkillCommands(new FakeProvider(page), NAMES, () => COMMANDS)

    expect(await wrapped.getSuggestions(["/skill:"], 0, 7, { signal })).toBe(page)
    expect(await wrapped.getSuggestions(["/skill:ulw"], 0, 10, { signal })).toBe(page)
  })

  test("#given the user types /skill without the colon #when suggestions are requested #then the skill:<name> rows stay, since that is where the user is going (#9648)", async () => {
    const page = { prefix: "/skill", items: [{ value: "skill:ulw-execute", label: "skill:ulw-execute" }, { value: "skill:ulw-plan", label: "skill:ulw-plan" }] }
    const wrapped = wrapWithBareSkillCommands(new FakeProvider(page), NAMES, () => COMMANDS)

    expect(values((await wrapped.getSuggestions(["/skill"], 0, 6, { signal }))?.items)).toEqual(["skill:ulw-execute", "skill:ulw-plan"])
  })

  test("#given senpi marks a skill row as awaiting arguments #when the user types /ulw #then its alias waits too and shows the same hint", async () => {
    const base = new FakeProvider({
      prefix: "/ulw",
      items: [
        { value: "skill:ulw-execute", label: "skill:ulw-execute", description: "[plan-name] — Executes a work plan.", awaitsArguments: true },
        { value: "skill:ulw-plan", label: "skill:ulw-plan", description: "Plans first." },
      ],
    })
    const wrapped = wrapWithBareSkillCommands(base, NAMES, () => COMMANDS)

    const result = await wrapped.getSuggestions(["/ulw"], 0, 4, { signal })

    expect(result?.items[0]).toEqual({ value: "ulw-execute", label: "ulw-execute", description: "[plan-name] — Executes a work plan.", awaitsArguments: true })
    expect(result?.items[1]).toEqual({ value: "ulw-plan", label: "ulw-plan", description: "Plans first." })
  })

  test("#given ulw-research is disabled #when the user types /ulw #then its alias is not offered", async () => {
    const wrapped = wrapWithBareSkillCommands(new FakeProvider(null), NAMES, () => COMMANDS)

    const result = await wrapped.getSuggestions(["/ulw-r"], 0, 6, { signal })

    expect(result).toBeNull()
  })

  test("#given senpi has no suggestion page #when the user types /init-d #then the alias alone is offered with the typed prefix", async () => {
    const wrapped = wrapWithBareSkillCommands(new FakeProvider(null), NAMES, () => COMMANDS)

    const result = await wrapped.getSuggestions(["/init-d"], 0, 7, { signal })

    expect(result).toEqual({ prefix: "/init-d", items: [{ value: "init-deep", label: "init-deep" }] })
  })

  test("#given inputs outside a leading command token #when suggestions are requested #then senpi's page is returned unchanged", async () => {
    const page = { prefix: "/", items: [{ value: "settings", label: "settings" }] }
    const wrapped = wrapWithBareSkillCommands(new FakeProvider(page), NAMES, () => COMMANDS)

    expect(await wrapped.getSuggestions(["/"], 0, 1, { signal })).toBe(page)
    expect(await wrapped.getSuggestions(["/ulw-execute plan"], 0, 17, { signal })).toBe(page)
    expect(await wrapped.getSuggestions(["first", "/ulw"], 1, 4, { signal })).toBe(page)
    expect(await wrapped.getSuggestions(["/ulw"], 0, 4, { signal, force: true })).toBe(page)
  })

  test("#given the wrapped provider #when other members are used #then they are the base provider's own", () => {
    const base = new FakeProvider(null)
    const wrapped = wrapWithBareSkillCommands(base, NAMES, () => COMMANDS)

    expect(wrapped.applyCompletion(["/ulw"], 0, 4, { value: "ulw-plan" }, "/ulw")).toBe("applied-by-base")
    expect(base.applied).toHaveLength(1)
    expect(wrapped.triggerCharacters).toEqual(["$"])
  })
})
