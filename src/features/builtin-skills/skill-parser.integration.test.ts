import { describe, expect, test } from "bun:test"
import { createBuiltinSkills } from "./skills"

describe("createBuiltinSkills frontmatter wiring", () => {
  test("surfaces SKILL.md frontmatter metadata for file-based builtin skills", () => {
    const skills = createBuiltinSkills()
    const goSkill = skills.find((s) => s.name === "backend-pattern-go")

    expect(goSkill).toBeDefined()
    expect(goSkill?.metadata).toMatchObject({
      skillFrontmatter: {
        triggers: ["golang backend", "go api", "go microservice"],
        priority: "medium",
      },
    })
  })
})
