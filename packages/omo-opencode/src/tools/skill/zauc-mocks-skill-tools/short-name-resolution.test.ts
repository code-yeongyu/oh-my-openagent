/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createMockSkill, createSkillTool, mockContext } from "./test-support"

describe("skill tool - short name resolution", () => {
  it("resolves namespaced skill by short name when unambiguous", async () => {
    const loadedSkills = [createMockSkill("toolkit/systematic-debugging")]
    const tool = createSkillTool({ skills: loadedSkills })

    const result = await tool.execute({ name: "systematic-debugging" }, mockContext)

    expect(result).toContain("toolkit/systematic-debugging")
  })

  it("still resolves by exact full name", async () => {
    const loadedSkills = [createMockSkill("toolkit/systematic-debugging")]
    const tool = createSkillTool({ skills: loadedSkills })

    const result = await tool.execute({ name: "toolkit/systematic-debugging" }, mockContext)

    expect(result).toContain("toolkit/systematic-debugging")
  })

  it("does not resolve short name when ambiguous (multiple matches)", async () => {
    const loadedSkills = [
      createMockSkill("toolkit/debugging"),
      createMockSkill("utils/debugging"),
    ]
    const tool = createSkillTool({ skills: loadedSkills })

    return expect(tool.execute({ name: "debugging" }, mockContext)).rejects.toThrow(
      "not found"
    )
  })

  it("prefers exact match over short name match", async () => {
    const loadedSkills = [
      createMockSkill("debugging"),
      createMockSkill("toolkit/debugging"),
    ]
    const tool = createSkillTool({ skills: loadedSkills })

    const result = await tool.execute({ name: "debugging" }, mockContext)

    expect(result).toContain("## Skill: debugging")
  })
})
