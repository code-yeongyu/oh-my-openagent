import { describe, expect, it } from "bun:test"
import { validateSkillContent } from "./skill-validator"

describe("skill-validator", () => {
  it("accepts flexible heading levels for required sections", () => {
    const content = `# Demo Skill

## When to Use This Skill
Use it when needed.

### Not For / Boundaries
Do not use for trivial edits.

# Anti-Patterns (NEVER)
- skipping tests
`

    const result = validateSkillContent(content, "demo")
    expect(result.isValid).toBe(true)
    expect(result.missingParts).toEqual([])
  })

  it("reports missing required sections", () => {
    const content = `# Demo Skill\n\n## When to Use\nOnly this section exists.`

    const result = validateSkillContent(content, "demo")
    expect(result.isValid).toBe(false)
    expect(result.missingParts).toContain("Boundaries/Not For")
    expect(result.missingParts).toContain("Anti-Patterns")
  })
})
