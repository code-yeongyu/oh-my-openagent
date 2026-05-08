import { describe, expect, test } from "bun:test"
import { buildDefaultSisyphusJuniorPrompt } from "./default"
import { buildGlmSisyphusJuniorPrompt } from "./glm"

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe("buildGlmSisyphusJuniorPrompt", () => {
  test("#given no append #then keeps the default Junior prompt as its base", () => {
    // given
    const basePrompt = buildDefaultSisyphusJuniorPrompt(false)

    // when
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    // then
    expect(prompt.startsWith(basePrompt)).toBe(true)
  })

  test("#given no append #then includes GLM execution mode block", () => {
    // given / when
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    // then
    expect(prompt).toContain("GLM-5.1 Execution Mode")
    expect(prompt).toContain("Stay an executor")
  })

  test("#given no append #then includes vision tool routing and token discipline", () => {
    // given / when
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    // then
    expect(prompt).toContain("zai-mcp-server")
    expect(prompt).toContain("Token Discipline")
    expect(prompt).not.toContain("goal.md")
    expect(prompt).not.toContain("decisions.md")
  })

  test("#given promptAppend #then appends it exactly once", () => {
    // given
    const promptAppend = "Extra instructions here"

    // when
    const prompt = buildGlmSisyphusJuniorPrompt(false, promptAppend)

    // then
    expect(countOccurrences(prompt, promptAppend)).toBe(1)
  })
})
