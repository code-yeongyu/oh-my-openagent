/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createExploreAgent } from "./explore"

describe("explore agent tool strategy", () => {
  const model = "openai/gpt-5.4-mini-fast"

  it("#given the prompt #when inspecting #then includes ast_grep_search in tool strategy", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("ast_grep_search")
    expect(prompt.toLowerCase()).toContain("structural patterns")
  })

  it("#given the prompt #when inspecting #then includes grep in tool strategy", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("grep")
    expect(prompt.toLowerCase()).toContain("text patterns")
  })

  it("#given the prompt #when inspecting #then includes lsp tools in tool strategy", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("LSP tools")
    expect(prompt.toLowerCase()).toContain("semantic search")
  })

  it("#given the prompt #when inspecting #then includes glob in tool strategy", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("glob")
    expect(prompt.toLowerCase()).toContain("file patterns")
  })

  it("#given the prompt #when inspecting #then requires parallel execution", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("3+ tools simultaneously")
  })

  it("#given the prompt #when inspecting #then preserves the absolute-path requirement", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("absolute")
    expect(prompt).toContain("<results>")
  })

  it("#given the prompt #when inspecting #then keeps the read-only and no-emoji constraints", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("Read-only")
    expect(prompt).toContain("No emojis")
  })
})
