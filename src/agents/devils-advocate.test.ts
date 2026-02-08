/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { createDevilsAdvocateAgent, devilsAdvocatePromptMetadata } from "./devils-advocate"

describe("createDevilsAdvocateAgent", () => {
  test("returns a subagent with allowlist-based read-only tool permissions", () => {
    // given
    const model = "google/gemini-3-pro"

    // when
    const agent = createDevilsAdvocateAgent(model)

    // then
    expect(agent.mode).toBe("subagent")
    expect(agent.model).toBe(model)
    expect(agent.temperature).toBe(0.1)

    expect(agent.permission).toBeDefined()

    expect(agent.permission?.["*"]).toBe("deny")
    expect(agent.permission?.["read"]).toBe("allow")
    expect(agent.permission?.["grep"]).toBe("allow")
    expect(agent.permission?.["glob"]).toBe("allow")
    expect(agent.permission?.["lsp_diagnostics"]).toBe("allow")
    expect(agent.permission?.["lsp_symbols"]).toBe("allow")
    expect(agent.permission?.["lsp_find_references"]).toBe("allow")
    expect(agent.permission?.["lsp_goto_definition"]).toBe("allow")
    expect(agent.permission?.["webfetch"]).toBe("allow")
    expect(agent.permission?.["ast_grep_search"]).toBe("allow")
  })

  test("uses reasoningEffort for GPT-family models", () => {
    // given
    const model = "openai/gpt-5.2"

    // when
    const agent = createDevilsAdvocateAgent(model)

    // then
    expect(agent.reasoningEffort).toBe("medium")
    expect(agent.thinking).toBeUndefined()
  })

  test("uses thinking for non-GPT models", () => {
    // given
    const model = "google/gemini-3-pro"

    // when
    const agent = createDevilsAdvocateAgent(model)

    // then
    expect(agent.thinking).toEqual({ type: "enabled", budgetTokens: 10000 })
    expect(agent.reasoningEffort).toBeUndefined()
  })
})

describe("devilsAdvocatePromptMetadata", () => {
  test("declares advisor category and CHEAP cost", () => {
    // given

    // when
    const metadata = devilsAdvocatePromptMetadata

    // then
    expect(metadata.category).toBe("advisor")
    expect(metadata.cost).toBe("CHEAP")
  })

  test("defines triggers and keyTrigger", () => {
    // given

    // when
    const metadata = devilsAdvocatePromptMetadata

    // then
    expect(metadata.triggers.length).toBeGreaterThan(0)
    expect(typeof metadata.keyTrigger).toBe("string")
    expect((metadata.keyTrigger ?? "").length).toBeGreaterThan(0)
  })
})
