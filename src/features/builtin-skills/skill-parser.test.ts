import { describe, expect, test } from "bun:test"
import { parseSkillTemplate } from "./skill-parser"

describe("parseSkillTemplate", () => {
  test("parses frontmatter fields and trims body", () => {
    const content = `---
description: Parsed description
hooks:
  - PreToolUse
triggers:
  - parse me
priority: high
---

# Skill title
Body`

    const parsed = parseSkillTemplate(content)

    expect(parsed.description).toBe("Parsed description")
    expect(parsed.hooks).toEqual(["PreToolUse"])
    expect(parsed.triggers).toEqual(["parse me"])
    expect(parsed.priority).toBe("high")
    expect(parsed.template).toBe("# Skill title\nBody")
  })

  test("falls back safely when frontmatter is missing", () => {
    const content = "# Skill title\nBody"

    const parsed = parseSkillTemplate(content)

    expect(parsed.description).toBeUndefined()
    expect(parsed.hooks).toEqual([])
    expect(parsed.triggers).toEqual([])
    expect(parsed.priority).toBe("medium")
    expect(parsed.template).toBe(content)
  })

  test("falls back safely when frontmatter is invalid", () => {
    const content = `---
description: [invalid
priority: high
---
# Skill title`

    const parsed = parseSkillTemplate(content)

    expect(parsed.description).toBeUndefined()
    expect(parsed.hooks).toEqual([])
    expect(parsed.triggers).toEqual([])
    expect(parsed.priority).toBe("medium")
    expect(parsed.template).toBe("# Skill title")
  })
})
