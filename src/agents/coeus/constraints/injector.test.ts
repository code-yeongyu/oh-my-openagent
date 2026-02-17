import { describe, it, expect } from "bun:test"
import { injectConstraints } from "./injector"

describe("injectConstraints", () => {
  //#given constraints and a base prompt
  //#when injectConstraints is called
  //#then constraints are wrapped in global-constraints tags and prepended to base prompt

  it("should inject constraints with proper wrapper tags", () => {
    const basePrompt = "This is the base prompt"
    const constraints = "Do not modify files"

    const result = injectConstraints(basePrompt, constraints)

    expect(result).toContain("<global-constraints>")
    expect(result).toContain("</global-constraints>")
    expect(result).toContain("## Global Project Constraints (NON-NEGOTIABLE)")
    expect(result).toContain("Do not modify files")
  })

  it("should preserve original prompt content fully", () => {
    const basePrompt = "This is the base prompt with important content"
    const constraints = "Some constraint"

    const result = injectConstraints(basePrompt, constraints)

    expect(result).toContain(basePrompt)
    expect(result.includes(basePrompt)).toBe(true)
  })

  it("should return basePrompt unchanged when constraints is empty string", () => {
    const basePrompt = "This is the base prompt"
    const constraints = ""

    const result = injectConstraints(basePrompt, constraints)

    expect(result).toBe(basePrompt)
  })

  it("should return basePrompt unchanged when constraints is whitespace only", () => {
    const basePrompt = "This is the base prompt"
    const constraints = "   \n\t  "

    const result = injectConstraints(basePrompt, constraints)

    expect(result).toBe(basePrompt)
  })

  it("should preserve special characters in constraints", () => {
    const basePrompt = "Base prompt"
    const constraints = "Use `backticks` and <angle brackets> and [square brackets]"

    const result = injectConstraints(basePrompt, constraints)

    expect(result).toContain("`backticks`")
    expect(result).toContain("<angle brackets>")
    expect(result).toContain("[square brackets]")
  })

  it("should add newline separator between constraints block and base prompt", () => {
    const basePrompt = "Base prompt"
    const constraints = "Some constraint"

    const result = injectConstraints(basePrompt, constraints)

    // Should have </global-constraints> followed by newline(s) then base prompt
    const constraintsEndIndex = result.indexOf("</global-constraints>")
    const basePromptIndex = result.indexOf(basePrompt)

    expect(constraintsEndIndex).toBeGreaterThan(-1)
    expect(basePromptIndex).toBeGreaterThan(constraintsEndIndex)

    // Check there's whitespace between them
    const between = result.substring(constraintsEndIndex + "</global-constraints>".length, basePromptIndex)
    expect(between.trim()).toBe("")
  })

  it("should not double-inject constraints on multiple calls (idempotency)", () => {
    const basePrompt = "Base prompt"
    const constraints = "Some constraint"

    const firstCall = injectConstraints(basePrompt, constraints)
    const secondCall = injectConstraints(firstCall, constraints)

    // Count occurrences of <global-constraints>
    const firstCount = (firstCall.match(/<global-constraints>/g) || []).length
    const secondCount = (secondCall.match(/<global-constraints>/g) || []).length

    expect(firstCount).toBe(1)
    expect(secondCount).toBe(1)
  })

  it("should include instruction text about constraints being non-removable", () => {
    const basePrompt = "Base prompt"
    const constraints = "Some constraint"

    const result = injectConstraints(basePrompt, constraints)

    expect(result).toContain("extracted from the project")
    expect(result).toContain("MUST be respected")
  })

  it("should handle multi-line constraints", () => {
    const basePrompt = "Base prompt"
    const constraints = `Line 1
Line 2
Line 3`

    const result = injectConstraints(basePrompt, constraints)

    expect(result).toContain("Line 1")
    expect(result).toContain("Line 2")
    expect(result).toContain("Line 3")
  })

  it("should place constraints block before base prompt", () => {
    const basePrompt = "Base prompt content"
    const constraints = "Constraint content"

    const result = injectConstraints(basePrompt, constraints)

    const constraintsIndex = result.indexOf("<global-constraints>")
    const basePromptIndex = result.indexOf(basePrompt)

    expect(constraintsIndex).toBeLessThan(basePromptIndex)
  })
})
