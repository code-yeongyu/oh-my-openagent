/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createLibrarianAgent } from "./librarian"

describe("librarian agent ast-grep discipline", () => {
  const model = "openai/gpt-5.4-mini-fast"

  it("#given the prompt #when inspecting TOOL REFERENCE #then documents ast_grep_search", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("ast_grep_search")
    expect(prompt).toContain("$$$")
    expect(prompt).toContain("function $NAME($$$) { $$$ }")
  })

  it("#given the prompt #when inspecting #then warns against regex inside ast_grep_search", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt.toLowerCase()).toContain("not regex")
    expect(prompt).toContain("|")
    expect(prompt).toContain(".*")
    expect(prompt).toContain("\\w")
  })

  it("#given the prompt #when inspecting #then directs LLM to grep/grep_app for text search", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt.toLowerCase()).toContain("for text")
    expect(prompt).toContain("grep_app")
  })

  it("#given the prompt #when inspecting Implementation phase #then recommends ast_grep_search for code shape", () => {
    // given
    const agent = createLibrarianAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("ast_grep_search for code shape")
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
