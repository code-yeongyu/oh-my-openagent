import { describe, test, expect } from "bun:test"
import { createImplementerAgent } from "./implementer"

describe("Implementer agent prompt", () => {
  test("requires Codex prototype and review steps", () => {
    // #given
    const prompt = createImplementerAgent().prompt ?? ""

    // #when / #then
    expect(prompt.toLowerCase()).toMatch(/codex.*prototype|prototype.*codex|phase 2|stage 2/)
    expect(prompt.toLowerCase()).toMatch(/codex.*review|review.*codex|phase 3|stage 3/)
  })

  test("enforces TDD and forbids delegation", () => {
    // #given
    const prompt = createImplementerAgent().prompt ?? ""

    // #when / #then
    expect(prompt.toLowerCase()).toMatch(/test-driven-development|tdd|red.*green.*refactor/)
    expect(prompt.toLowerCase()).toMatch(/no delegation|do not delegate|no subagent/)
  })
})
