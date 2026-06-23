import { describe, expect, it } from "bun:test"
import { buildCustomInstructions, INSTRUCTION_PRESETS } from "./custom-instructions"

describe("buildCustomInstructions", () => {
  it("#given store_rules #when built #then includes STORE section", () => {
    const result = buildCustomInstructions({ store_rules: ["rule1", "rule2"] })
    expect(result).toContain("STORE:")
    expect(result).toContain("  - rule1")
    expect(result).toContain("  - rule2")
  })

  it("#given ignore_rules #when built #then includes IGNORE section", () => {
    const result = buildCustomInstructions({ ignore_rules: ["ignore1"] })
    expect(result).toContain("IGNORE:")
    expect(result).toContain("  - ignore1")
  })

  it("#given confidence_rules #when built #then includes CONFIDENCE section", () => {
    const result = buildCustomInstructions({ confidence_rules: ["high confidence needed"] })
    expect(result).toContain("CONFIDENCE:")
    expect(result).toContain("  - high confidence needed")
  })

  it("#given empty config #when built #then returns empty string", () => {
    expect(buildCustomInstructions({})).toBe("")
  })

  it("#given empty arrays #when built #then omits empty sections", () => {
    const result = buildCustomInstructions({ store_rules: [], ignore_rules: ["x"] })
    expect(result).not.toContain("STORE:")
    expect(result).toContain("IGNORE:")
  })

  it("#given all three rule types #when built #then contains all three headings", () => {
    const result = buildCustomInstructions({
      store_rules: ["s"],
      ignore_rules: ["i"],
      confidence_rules: ["c"],
    })
    expect(result).toContain("STORE:")
    expect(result).toContain("IGNORE:")
    expect(result).toContain("CONFIDENCE:")
  })
})

describe("INSTRUCTION_PRESETS.software_engineering", () => {
  it("#given preset #when read #then is a non-empty string", () => {
    expect(typeof INSTRUCTION_PRESETS.software_engineering).toBe("string")
    expect(INSTRUCTION_PRESETS.software_engineering.length).toBeGreaterThan(0)
  })

  it("#given preset #when inspected #then contains all three sections", () => {
    const preset = INSTRUCTION_PRESETS.software_engineering
    expect(preset).toContain("STORE:")
    expect(preset).toContain("IGNORE:")
    expect(preset).toContain("CONFIDENCE:")
  })
})
