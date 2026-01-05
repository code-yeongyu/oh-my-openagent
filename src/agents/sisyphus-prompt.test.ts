import { describe, expect, test } from "bun:test"
import { createSisyphusAgent } from "./sisyphus"

describe("Sisyphus prompt dialect", () => {
  test("GPT/Codex prompt assumes implementation for code-change requests", () => {
    // #given
    const agent = createSisyphusAgent("openai/codex-1", [], [], [])

    // #then
    expect(agent.prompt).toContain("implies code changes")
    expect(agent.prompt).toContain("Do NOT output patches or diffs in chat")
    expect(agent.prompt).not.toContain("NEVER START IMPLEMENTING")
  })

  test("GPT/Codex prompt applies to gpt-5.1-codex", () => {
    // #given
    const agent = createSisyphusAgent("openai/gpt-5.1-codex", [], [], [])

    // #then
    expect(agent.prompt).toContain("implies code changes")
    expect(agent.prompt).toContain("Do NOT output patches or diffs in chat")
    expect(agent.prompt).not.toContain("NEVER START IMPLEMENTING")
  })

  test("Claude prompt keeps explicit-implementation guard", () => {
    // #given
    const agent = createSisyphusAgent("anthropic/claude-opus-4-5", [], [], [])

    // #then
    expect(agent.prompt).toContain("NEVER START IMPLEMENTING")
  })
})
