import { describe, expect, test } from "bun:test"

import { ToolsInputSchema, normalizeToolRules, resolveToolRule } from "./tools"

describe("tools pi-task contract shapes", () => {
  test("#given a string-action record #when parsing and normalizing #then allow and deny map to boolean rules", () => {
    // given
    const parsed = ToolsInputSchema.parse({ read: "allow", write: "deny" })

    // when
    const rules = normalizeToolRules(parsed) ?? []

    // then
    expect(resolveToolRule(rules, "read")).toBe(true)
    expect(resolveToolRule(rules, "write")).toBe(false)
    expect(resolveToolRule(rules, "other")).toBeUndefined()
  })

  test("#given a nested command-pattern map #when resolving #then last matching pattern wins", () => {
    // given
    const parsed = ToolsInputSchema.parse({ bash: { "*": "deny", "rg *": "allow" } })

    // when
    const rules = normalizeToolRules(parsed) ?? []

    // then
    expect(resolveToolRule(rules, "bash rg foo")).toBe(true)
    expect(resolveToolRule(rules, "bash ls")).toBe(false)
  })

  test("#given a reversed nested map #when resolving #then the trailing broad deny wins over the earlier allow", () => {
    // given
    const parsed = ToolsInputSchema.parse({ bash: { "rg *": "allow", "*": "deny" } })

    // when
    const rules = normalizeToolRules(parsed) ?? []

    // then
    expect(resolveToolRule(rules, "bash rg foo")).toBe(false)
    expect(resolveToolRule(rules, "bash ls")).toBe(false)
  })

  test("#given a mixed record of boolean string-action and nested map #when resolving #then every shape evaluates", () => {
    // given
    const parsed = ToolsInputSchema.parse({ read: true, write: "deny", bash: { "rg *": "allow" } })

    // when
    const rules = normalizeToolRules(parsed) ?? []

    // then
    expect(resolveToolRule(rules, "read")).toBe(true)
    expect(resolveToolRule(rules, "write")).toBe(false)
    expect(resolveToolRule(rules, "bash rg foo")).toBe(true)
  })

  test("#given an ask action #when resolving #then it is a non-grant and overrides a broader allow", () => {
    // given
    const standalone = normalizeToolRules(ToolsInputSchema.parse({ danger: "ask" })) ?? []
    const scoped = normalizeToolRules(ToolsInputSchema.parse({ bash: { "*": "allow", "danger*": "ask" } })) ?? []

    // then
    expect(resolveToolRule(standalone, "danger")).toBe(false)
    expect(resolveToolRule(scoped, "bash safe")).toBe(true)
    expect(resolveToolRule(scoped, "bash danger-op")).toBe(false)
  })

  test("#given the existing boolean-record shape #when normalizing #then it keeps working unchanged", () => {
    // given
    const parsed = ToolsInputSchema.parse({ read: true, write: false })

    // when
    const rules = normalizeToolRules(parsed) ?? []

    // then
    expect(resolveToolRule(rules, "read")).toBe(true)
    expect(resolveToolRule(rules, "write")).toBe(false)
  })

  test("#given the existing array shape #when normalizing #then bang-prefixed entries deny and plain entries allow", () => {
    // given
    const parsed = ToolsInputSchema.parse(["shell", "!danger"])

    // when
    const rules = normalizeToolRules(parsed) ?? []

    // then
    expect(resolveToolRule(rules, "shell")).toBe(true)
    expect(resolveToolRule(rules, "danger")).toBe(false)
  })
})
