import { describe, test, expect } from "bun:test"
import { createSisyphusAgent } from "./sisyphus"

describe("Sisyphus prompt plan review gate", () => {
  test("should require explicit plan review confirmation", () => {
    // #given
    const prompt = createSisyphusAgent("anthropic/claude-opus-4-5").prompt ?? ""

    // #when / #then
    expect(prompt.toLowerCase()).toMatch(/plan review gate|plan审查门控/)
    expect(prompt.toLowerCase()).toMatch(/wait.*confirm|等待.*确认|explicit.*confirm/)
  })
})
