/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import {
  createMockCommand,
  createMockSkill,
  createSkillTool,
  mockContext,
} from "./test-support"

describe("skill tool - synchronous description", () => {
  it("omits pre-provided skills from available_items by default", () => {
    const loadedSkills = [createMockSkill("test-skill")]

    const tool = createSkillTool({ skills: loadedSkills })

    expect(tool.description).not.toContain("<available_items>")
    expect(tool.description).not.toContain("test-skill")
  })

  it("includes all pre-provided skills in available_items when explicitly requested", () => {
    const loadedSkills = [
      createMockSkill("playwright"),
      createMockSkill("frontend"),
      createMockSkill("git-master"),
    ]

    const tool = createSkillTool({
      skills: loadedSkills,
      includeSkillsInDescription: true,
    })

    expect(tool.description).toContain("<available_items>")
    expect(tool.description).toContain("playwright")
    expect(tool.description).toContain("frontend")
    expect(tool.description).toContain("git-master")
  })

  it("shows no-skills message immediately when empty skills are pre-provided", () => {
    const tool = createSkillTool({ skills: [] })

    expect(tool.description).toContain("No skills are currently available")
  })
})

describe("skill tool - ordering and priority", () => {
  it("shows skills as command items with slash prefix in available_items", () => {
    const skills = [
      createMockSkill("builtin-skill", { scope: "builtin" }),
      createMockSkill("project-skill", { scope: "project" }),
    ]
    const commands = [
      createMockCommand("project-cmd", "project"),
      createMockCommand("builtin-cmd", "builtin"),
    ]

    const tool = createSkillTool({
      skills,
      commands,
      includeSkillsInDescription: true,
    })

    const desc = tool.description
    expect(desc).toContain("<name>/builtin-skill</name>")
    expect(desc).toContain("<name>/project-skill</name>")
    expect(desc).not.toContain("<skill>")
    const skillCmdIndex = desc.indexOf("/project-skill")
    const regularCmdIndex = desc.indexOf("/project-cmd")
    expect(skillCmdIndex).toBeLessThan(regularCmdIndex)
  })

  it("sorts skill-commands by priority: project > user > opencode > builtin", () => {
    const skills = [
      createMockSkill("builtin-skill", { scope: "builtin" }),
      createMockSkill("opencode-skill", { scope: "opencode" }),
      createMockSkill("project-skill", { scope: "project" }),
      createMockSkill("user-skill", { scope: "user" }),
    ]

    const tool = createSkillTool({
      skills,
      includeSkillsInDescription: true,
    })

    const desc = tool.description
    const projectIndex = desc.indexOf("/project-skill")
    const userIndex = desc.indexOf("/user-skill")
    const opencodeIndex = desc.indexOf("/opencode-skill")
    const builtinIndex = desc.indexOf("/builtin-skill")

    expect(projectIndex).toBeLessThan(userIndex)
    expect(userIndex).toBeLessThan(opencodeIndex)
    expect(opencodeIndex).toBeLessThan(builtinIndex)
  })

  it("sorts commands by priority: project > user > opencode > builtin", () => {
    const commands = [
      createMockCommand("builtin-cmd", "builtin"),
      createMockCommand("opencode-cmd", "opencode"),
      createMockCommand("project-cmd", "project"),
      createMockCommand("user-cmd", "user"),
    ]

    const tool = createSkillTool({ commands })

    const desc = tool.description
    const projectIndex = desc.indexOf("project-cmd")
    const userIndex = desc.indexOf("user-cmd")
    const opencodeIndex = desc.indexOf("opencode-cmd")
    const builtinIndex = desc.indexOf("builtin-cmd")

    expect(projectIndex).toBeLessThan(userIndex)
    expect(userIndex).toBeLessThan(opencodeIndex)
    expect(opencodeIndex).toBeLessThan(builtinIndex)
  })

  it("uses <available_items> wrapper with unified command format", () => {
    const skills = [createMockSkill("test-skill", { scope: "project" })]
    const commands = [createMockCommand("test-cmd", "project")]

    const tool = createSkillTool({ skills, commands })

    expect(tool.description).toContain("<available_items>")
    expect(tool.description).toContain("</available_items>")
    expect(tool.description).not.toContain("<skill>")
    expect(tool.description).toContain("<command>")
    expect(tool.description).not.toContain("/test-skill")
    expect(tool.description).toContain("/test-cmd")
  })
})

describe("skill tool - agent-restricted skill visibility in description", () => {
  it("excludes agent-restricted skill from description <available_items>", () => {
    const loadedSkills = [
      createMockSkill("public-skill"),
      createMockSkill("oracle-only-skill", { agent: "oracle" }),
    ]

    const tool = createSkillTool({
      skills: loadedSkills,
      includeSkillsInDescription: true,
    })

    expect(tool.description).toContain("public-skill")
    expect(tool.description).not.toContain("oracle-only-skill")
  })

  it("includes public skill (no agent field) in description regardless of context", () => {
    const loadedSkills = [createMockSkill("public-skill")]

    const tool = createSkillTool({
      skills: loadedSkills,
      includeSkillsInDescription: true,
    })

    expect(tool.description).toContain("public-skill")
  })

  it("execute still works for agent-restricted skill when called with correct agent context", async () => {
    const restrictedSkill = createMockSkill("oracle-only-skill", { agent: "oracle" })
    const tool = createSkillTool({ skills: [restrictedSkill] })
    const oracleContext = { ...mockContext, agent: "oracle" }

    const result = await tool.execute({ name: "oracle-only-skill" }, oracleContext)

    expect(result).toContain("oracle-only-skill")
  })
})
