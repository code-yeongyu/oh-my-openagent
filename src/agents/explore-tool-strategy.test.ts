/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createExploreAgent } from "./explore"

describe("explore agent tool strategy", () => {
  const model = "openai/gpt-5.4-mini-fast"

  it("#given the prompt #when inspecting #then defaults to grep for most searches", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt.toLowerCase()).toContain("default to `grep`")
  })

  it("#given the prompt #when inspecting #then warns against regex in ast_grep_search", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("ast_grep_search")
    expect(prompt.toLowerCase()).toContain("not use regex")
    expect(prompt).toContain("|")
    expect(prompt).toContain(".*")
    expect(prompt).toContain("\\w")
  })

  it("#given the prompt #when inspecting #then mandates falling back to grep on regex-shaped patterns", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt.toLowerCase()).toContain("switch to grep")
  })

  it("#given the prompt #when inspecting #then gives concrete AST pattern examples", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt).toContain("$$$")
    expect(prompt).toContain("function $NAME")
  })

  it("#given the prompt #when inspecting #then tells LLM to read the returned hint before retrying", () => {
    // given
    const agent = createExploreAgent(model)

    // when
    const prompt = agent.prompt ?? ""

    // then
    expect(prompt.toLowerCase()).toContain("read the hint")
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
