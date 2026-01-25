import { describe, it, expect } from "bun:test"
import { createSlashcommandTool } from "./tools"
import type { CommandInfo } from "./types"
import type { LoadedSkill } from "../../features/opencode-skill-loader"

function createMockCommand(name: string, description = ""): CommandInfo {
  return {
    name,
    metadata: {
      name,
      description: description || `Test command ${name}`,
    },
    scope: "builtin",
  }
}

function createMockSkill(name: string, description = ""): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: description || `Test skill ${name}`,
      template: "Test template",
    },
    scope: "opencode-project",
  }
}

describe("slashcommand tool - synchronous description", () => {
  it("includes available_skills immediately when commands and skills are pre-provided", () => {
    // #given
    const commands = [createMockCommand("commit", "Create a git commit")]
    const skills = [createMockSkill("playwright", "Browser automation via Playwright MCP")]

    // #when
    const tool = createSlashcommandTool({ commands, skills })

    // #then
    expect(tool.description).toContain("<available_skills>")
    expect(tool.description).toContain("commit")
    expect(tool.description).toContain("playwright")
  })

  it("includes all pre-provided commands and skills in description immediately", () => {
    // #given
    const commands = [
      createMockCommand("commit", "Git commit"),
      createMockCommand("plan", "Create plan"),
    ]
    const skills = [
      createMockSkill("playwright", "Browser automation"),
      createMockSkill("frontend-ui-ux", "Frontend design"),
      createMockSkill("git-master", "Git operations"),
    ]

    // #when
    const tool = createSlashcommandTool({ commands, skills })

    // #then
    expect(tool.description).toContain("commit")
    expect(tool.description).toContain("plan")
    expect(tool.description).toContain("playwright")
    expect(tool.description).toContain("frontend-ui-ux")
    expect(tool.description).toContain("git-master")
  })

  it("shows prefix-only description when both commands and skills are empty", () => {
    // #given / #when
    const tool = createSlashcommandTool({ commands: [], skills: [] })

    // #then - even with no items, description should be built synchronously (not just prefix)
    expect(tool.description).toContain("Load a skill")
  })
})
