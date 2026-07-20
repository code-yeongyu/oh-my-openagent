import { describe, expect, test } from "bun:test"
import { buildListModelsOutput, formatModelList, REASONING_VALUES } from "./tools"

describe("list_models formatting", () => {
  test("#given connected models #then grouped by provider, sorted, verbatim ids", () => {
    // when
    const out = formatModelList(new Set(["openai/gpt-5.5", "anthropic/claude-opus-4-8", "openai/gpt-5.4-mini"]))
    // then
    expect(out).toContain("anthropic:")
    expect(out).toContain("  - anthropic/claude-opus-4-8")
    expect(out).toContain("openai:")
    expect(out).toContain("  - openai/gpt-5.4-mini")
    expect(out).toContain("  - openai/gpt-5.5")
    // anthropic sorts before openai
    expect(out.indexOf("anthropic:")).toBeLessThan(out.indexOf("openai:"))
  })

  test("#given provider filter #then only that provider is listed", () => {
    // when
    const out = formatModelList(new Set(["openai/gpt-5.5", "anthropic/claude-opus-4-8"]), "openai")
    // then
    expect(out).toContain("openai/gpt-5.5")
    expect(out).not.toContain("anthropic")
  })

  test("#given empty set #then cold-cache guidance (not an error)", () => {
    // when
    const out = formatModelList(new Set())
    // then
    expect(out.toLowerCase()).toContain("cold cache")
  })

  test("#given provider filter with no matches #then helpful message", () => {
    // when
    const out = formatModelList(new Set(["openai/gpt-5.5"]), "ghost")
    // then
    expect(out).toContain('provider "ghost"')
  })

  test("#then full output includes reasoning vocabulary + usage examples", () => {
    // when
    const out = buildListModelsOutput(new Set(["openai/gpt-5.5"]))
    // then
    for (const v of REASONING_VALUES) expect(out).toContain(v)
    expect(out).toContain("reasoning_effort")
    expect(out).toContain('task(subagent_type="librarian"')
    expect(out).toContain("call_omo_agent(")
    expect(out).toContain("Unknown models are rejected")
  })
})
