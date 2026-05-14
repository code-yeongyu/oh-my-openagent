import { describe, test, expect } from "bun:test"
import { buildGlmSisyphusPrompt } from "./sisyphus/glm"

describe("GLM Parallel Dispatch", () => {
  test("Sisyphus GLM prompt contains parallel dispatch guidance", () => {
    const prompt = buildGlmSisyphusPrompt("glm-5.1", [], [], [], [])
    expect(prompt).toContain("<parallel_dispatch>")
  })

  test("Sisyphus GLM prompt does not mention budgetTokens", () => {
    const prompt = buildGlmSisyphusPrompt("glm-5.1", [], [], [], [])
    expect(prompt).not.toContain("budgetTokens")
  })

  test("Sisyphus GLM prompt contains execution loop", () => {
    const prompt = buildGlmSisyphusPrompt("glm-5.1", [], [], [], [])
    expect(prompt).toContain("<execution_loop>")
    expect(prompt).toContain("<verification_loop>")
    expect(prompt).toContain("EXPLORE")
    expect(prompt).toContain("EXECUTE_OR_SUPERVISE")
    expect(prompt).toContain("VERIFY")
    expect(prompt).toContain("DONE")
  })
})
