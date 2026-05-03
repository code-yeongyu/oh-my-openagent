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

  test("#given no append #then adds exactly one GLM context block", () => {
    // given / when
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    // then
    expect(countOccurrences(prompt, "<Small_Context_Working_Memory>")).toBe(1)
    expect(countOccurrences(prompt, "</Small_Context_Working_Memory>")).toBe(1)
  })

  test("#given no append #then stays lightweight and avoids full ledger instructions", () => {
    // given / when
    const prompt = buildGlmSisyphusJuniorPrompt(false)

    // then
    expect(prompt).toContain("Read only the slice named in the task prompt")
    expect(prompt).not.toContain("Toggle RL")
    expect(prompt).not.toContain("goal.md")
    expect(prompt).not.toContain("decisions.md")
    expect(prompt).not.toContain("files.md")
    expect(prompt).not.toContain("blockers.md")
    expect(prompt).not.toContain("verification.md")
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
