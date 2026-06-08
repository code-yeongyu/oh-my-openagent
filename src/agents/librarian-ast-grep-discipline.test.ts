/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createLibrarianAgent } from "./librarian"

describe("librarian agent ast-grep discipline", () => {
  const model = "openai/gpt-5.4-mini-fast"

  it("#given the prompt #when inspecting TYPE B phase #then mentions ast_grep_search for implementation", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("ast_grep_search")
    expect(prompt).toContain("grep/ast_grep_search for function/class")
  })

  it("#given the prompt #when inspecting TOOL REFERENCE #then documents grep_app for code search", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("grep_app")
    expect(prompt).toContain("Fast Code Search")
  })

  it("#given the prompt #when inspecting #then directs LLM to use gh CLI for repo operations", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("gh repo clone")
    expect(prompt).toContain("gh search issues")
  })

  it("#given the prompt #when inspecting #then requires parallel execution for comprehensive research", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("6+ calls")
    expect(prompt).toContain("Parallel acceleration")
  })

  it("#given the prompt #when inspecting #then preserves the evidence + permalink contract", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("GitHub permalinks")
    expect(prompt).toContain("MANDATORY CITATION FORMAT")
  })

  it("#given the prompt #when inspecting #then preserves request classification phases", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("TYPE A: CONCEPTUAL")
    expect(prompt).toContain("TYPE B: IMPLEMENTATION")
    expect(prompt).toContain("TYPE C: CONTEXT")
    expect(prompt).toContain("TYPE D: COMPREHENSIVE")
  })
})
