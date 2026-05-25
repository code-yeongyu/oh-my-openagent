import { describe, test, expect } from "bun:test"
import { MOMUS_SYSTEM_PROMPT, createMomusAgent } from "./momus"

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

describe("MOMUS_SYSTEM_PROMPT policy requirements", () => {
  test("should treat SYSTEM DIRECTIVE as ignorable/stripped", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT
    
    // when / #then
    // Should mention that system directives are ignored
    expect(prompt.toLowerCase()).toMatch(/system directive.*ignore|ignore.*system directive/)
    // Should give examples of system directive patterns
    expect(prompt).toMatch(/<system-reminder>|system-reminder/)
  })

  test("should extract paths containing .omo/plans/ and ending in .md", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT

    // when / #then
    expect(prompt).toContain(".omo/plans/")
    expect(prompt).toContain(".md")
    // New extraction policy should be mentioned
    expect(prompt.toLowerCase()).toMatch(/extract|search|find path/)
  })

  test("should NOT teach that 'Please review' is INVALID (conversational wrapper allowed)", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT

    // when / #then
    // In RED phase, this will FAIL because current prompt explicitly lists this as INVALID
    const invalidExample = "Please review .omo/plans/plan.md"
    const rejectionTeaching = new RegExp(
      `reject.*${escapeRegExp(invalidExample)}`,
      "i",
    )
    
    // We want the prompt to NOT reject this anymore. 
    // If it's still in the "INVALID" list, this test should fail.
    expect(prompt).not.toMatch(rejectionTeaching)
  })

  test("should handle ambiguity (2+ paths) and 'no path found' rejection", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT

    // when / #then
    // Should mention what happens when multiple paths are found
    expect(prompt.toLowerCase()).toMatch(/multiple|ambiguous|2\+|two/)
    // Should mention rejection if no path found
    expect(prompt.toLowerCase()).toMatch(/no.*path.*found|reject.*no.*path/)
  })
})

describe("Momus fresh reread contract", () => {
  test("default variant (MOMUS_SYSTEM_PROMPT) requires fresh reread of plan file", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT

    // when / #then
    // Must instruct fresh reread from disk, not trusting cached content
    expect(prompt).toMatch(/fresh reread|re-read from disk|must re-?read/)
    // Must accept .sisyphus/plans/ paths alongside .omo/plans/
    expect(prompt).toContain(".sisyphus/plans/")
    // Must warn that previous verdict cannot be trusted without re-reading
    expect(prompt).toMatch(/previous verdict|cannot trust.*without.*re-?read|stale.*verdict/)
  })

  test("GPT-5.5 variant (createMomusAgent(\"gpt-5.5\")) requires fresh reread", () => {
    // given
    const prompt = createMomusAgent("gpt-5.5").prompt

    // when / #then
    expect(prompt).toMatch(/fresh reread|re-read from disk|must re-?read/)
    expect(prompt).toContain(".sisyphus/plans/")
    expect(prompt).toMatch(/previous verdict|cannot trust.*without.*re-?read|stale.*verdict/)
  })

  test("GPT-5.2 variant (createMomusAgent(\"gpt-5.2\")) requires fresh reread", () => {
    // given
    const prompt = createMomusAgent("gpt-5.2").prompt

    // when / #then
    expect(prompt).toMatch(/fresh reread|re-read from disk|must re-?read/)
    expect(prompt).toContain(".sisyphus/plans/")
    expect(prompt).toMatch(/previous verdict|cannot trust.*without.*re-?read|stale.*verdict/)
  })
})

describe("Momus plan path validation", () => {
  test("should accept both .omo/plans/ and .sisyphus/plans/ as valid plan paths", () => {
    // given
    const prompt = MOMUS_SYSTEM_PROMPT

    // when / #then
    expect(prompt).toContain(".omo/plans/")
    expect(prompt).toContain(".sisyphus/plans/")
  })
})
