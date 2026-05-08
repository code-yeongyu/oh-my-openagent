import { describe, test, expect } from "bun:test"
import { buildGlmSisyphusPrompt } from "./sisyphus/glm"

describe("GLM Parallel Dispatch", () => {
  test("Sisyphus GLM prompt contains parallel dispatch guidance", () => {
    const prompt = buildGlmSisyphusPrompt("glm-5.1", [], [], [], [])
    expect(prompt).toContain("parallel")
  })

  test("Sisyphus GLM prompt does not mention budgetTokens", () => {
    const prompt = buildGlmSisyphusPrompt("glm-5.1", [], [], [], [])
    expect(prompt).not.toContain("budgetTokens")
  })

  test("Sisyphus GLM prompt contains execution loop", () => {
    const prompt = buildGlmSisyphusPrompt("glm-5.1", [], [], [], [])
    expect(prompt).toContain("DISPATCH")
    expect(prompt).toContain("DELEGATE")
    expect(prompt).toContain("COLLECT")
    expect(prompt).toContain("SYNTHESIZE")
  })
})
