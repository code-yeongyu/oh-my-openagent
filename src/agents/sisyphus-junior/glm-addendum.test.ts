/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { buildGlmSisyphusJuniorPrompt } from "./glm"

describe("SJ GLM Addendum", () => {
  test("contains GLM-5.1 Execution Mode", () => {
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    expect(prompt).toContain("GLM-5.1 Execution Mode")
  })

  test("contains bounded autonomy instructions", () => {
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    expect(prompt).toContain("Stay an executor")
    expect(prompt).toContain("Do not become an orchestrator")
  })

  test("contains category obedience", () => {
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    expect(prompt).toContain("category instructions")
  })

  test("contains vision MCP routing", () => {
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    expect(prompt).toContain("zai-mcp-server")
    expect(prompt).toContain("multimodal-looker")
  })

  test("contains token discipline", () => {
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    expect(prompt).toContain("Token Discipline")
  })

  test("does NOT contain 8-hour language", () => {
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    expect(prompt).not.toContain("8-hour")
    expect(prompt).not.toContain("8 hour")
  })
})
