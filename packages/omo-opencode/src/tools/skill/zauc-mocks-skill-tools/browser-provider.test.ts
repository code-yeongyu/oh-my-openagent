/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createMockSkill, createSkillTool, mockContext } from "./test-support"

describe("skill tool - browserProvider forwarding", () => {
  it("returns selected browser skill content during execution", async () => {
    // Given: the selected browser skill in the registry.
    const browserSkill = createMockSkill("dev-browser")
    const tool = createSkillTool({
      skills: [browserSkill],
      browserProvider: "dev-browser",
      includeSkillsInDescription: true,
    })
    // When: requesting the selected skill.
    const result = await tool.execute({ name: "dev-browser" }, mockContext)
    // Then: the registered template reaches the caller unchanged.
    expect(result).toContain(browserSkill.definition.template)
  })

  it("advertises the selected browser skill id", () => {
    // Given: an explicit alternate provider.
    const browserSkill = createMockSkill("dev-browser")
    // When: building the skill tool.
    const tool = createSkillTool({
      skills: [browserSkill],
      browserProvider: "dev-browser",
      includeSkillsInDescription: true,
    })
    // Then: the machine-routable skill name is advertised.
    expect(tool.description).toContain(browserSkill.name)
  })
})
