/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { unsafeTestValue } from "../../../../../../test-support/unsafe-test-value"
import { createMockSkill, createSkillTool, mockContext } from "./test-support"

describe("skill tool - agent restriction", () => {
  it("allows skill without agent restriction to any agent", async () => {
    const loadedSkills = [createMockSkill("public-skill")]
    const tool = createSkillTool({ skills: loadedSkills })
    const context = { ...mockContext, agent: "any-agent" }

    const result = await tool.execute({ name: "public-skill" }, context)

    expect(result).toContain("public-skill")
  })

  it("requests host skill permission before loading the skill", async () => {
    const loadedSkills = [createMockSkill("review-work")]
    const askCalls: Array<Parameters<ToolContext["ask"]>[0]> = []
    const tool = createSkillTool({ skills: loadedSkills })
    const context: ToolContext = {
      ...mockContext,
      ask: async (input) => {
        askCalls.push(input)
      },
    }

    await tool.execute({ name: "review-work" }, context)

    expect(askCalls).toEqual([
      {
        permission: "skill",
        patterns: ["review-work"],
        always: ["review-work"],
        metadata: { skill: "review-work" },
      },
    ])
  })

  it("allows skill when agent matches restriction", async () => {
    const loadedSkills = [createMockSkill("restricted-skill", { agent: "sisyphus" })]
    const tool = createSkillTool({ skills: loadedSkills })
    const context = { ...mockContext, agent: "sisyphus" }

    const result = await tool.execute({ name: "restricted-skill" }, context)

    expect(result).toContain("restricted-skill")
  })

  it("throws error when agent does not match restriction", async () => {
    const loadedSkills = [createMockSkill("sisyphus-only-skill", { agent: "sisyphus" })]
    const tool = createSkillTool({ skills: loadedSkills })
    const context = { ...mockContext, agent: "oracle" }

    return expect(tool.execute({ name: "sisyphus-only-skill" }, context)).rejects.toThrow(
      'Skill "sisyphus-only-skill" is restricted to agent "sisyphus"'
    )
  })

  it("throws error when context agent is undefined for restricted skill", async () => {
    const loadedSkills = [createMockSkill("sisyphus-only-skill", { agent: "sisyphus" })]
    const tool = createSkillTool({ skills: loadedSkills })
    const contextWithoutAgent = { ...mockContext, agent: unsafeTestValue<string>(undefined) }

    return expect(tool.execute({ name: "sisyphus-only-skill" }, contextWithoutAgent)).rejects.toThrow(
      'Skill "sisyphus-only-skill" is restricted to agent "sisyphus"'
    )
  })
})
