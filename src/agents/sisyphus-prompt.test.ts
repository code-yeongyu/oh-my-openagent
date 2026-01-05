import { describe, expect, test } from "bun:test"
import { createSisyphusAgent } from "./sisyphus"

describe("Sisyphus prompt dialect", () => {
  test("GPT/Codex prompt assumes implementation for code-change requests", () => {
    // #given
    const agent = createSisyphusAgent("openai/codex-1", [], [], [])

    // #then
    expect(agent.prompt).toContain("implies code changes")
    expect(agent.prompt).not.toContain("NEVER START IMPLEMENTING")
  })

  test("Claude prompt keeps explicit-implementation guard", () => {
    // #given
    const agent = createSisyphusAgent("anthropic/claude-opus-4-5", [], [], [])

    // #then
    expect(agent.prompt).toContain("NEVER START IMPLEMENTING")
  })
})
