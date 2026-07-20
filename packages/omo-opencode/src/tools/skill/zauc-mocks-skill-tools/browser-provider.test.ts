/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createMockSkill, createSkillTool, mockContext } from "./test-support"

describe("skill tool - browserProvider forwarding", () => {
  it("passes browserProvider to getAllSkills during execution", async () => {
    const agentBrowserSkill = createMockSkill("agent-browser")
    const tool = createSkillTool({
      skills: [agentBrowserSkill],
      browserProvider: "agent-browser",
      includeSkillsInDescription: true,
    })

    const result = await tool.execute({ name: "agent-browser" }, mockContext)

    expect(result).toContain("Skill: agent-browser")
  })

  it("description includes agent-browser when browserProvider is agent-browser", () => {
    const agentBrowserSkill = createMockSkill("agent-browser")

    const tool = createSkillTool({
      skills: [agentBrowserSkill],
      browserProvider: "agent-browser",
      includeSkillsInDescription: true,
    })

    expect(tool.description).toContain("agent-browser")
  })
})
