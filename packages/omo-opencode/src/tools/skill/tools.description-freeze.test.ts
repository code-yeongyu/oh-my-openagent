import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import type { CommandInfo } from "../slashcommand/types"
import { createSkillTool } from "./tools"

function createConfigSkill(name: string, agent?: string): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: `<skill-instruction>Body for ${name}</skill-instruction>`,
      ...(agent ? { agent } : {}),
    },
    scope: "config",
  }
}

function createConfigCommand(name: string): CommandInfo {
  return {
    name,
    path: `/test/commands/${name}.md`,
    metadata: {
      name,
      description: `Test command ${name}`,
    },
    content: `Body for ${name}`,
    scope: "config",
  }
}

const mockContext: ToolContext = {
  sessionID: "description-freeze-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("#given frozen skill tool description", () => {
  test("#when execute runs after description was seeded #then description bytes are unchanged", async () => {
    //#given
    const loaded = [createConfigSkill("freeze-public"), createConfigSkill("freeze-restricted", "sisyphus")]
    const skillTool = createSkillTool({
      directory: "/test",
      skills: loaded,
      commands: [],
      includeSkillsInDescription: true,
    })
    const before = skillTool.description

    //#when
    await skillTool.execute({ name: "no-such-skill" }, mockContext).catch(() => "thrown")

    //#then
    expect(skillTool.description).toBe(before)
  })

  test("#when restricted skill present #then excluded from description before and after execute", async () => {
    //#given
    const loaded = [createConfigSkill("freeze-public"), createConfigSkill("freeze-restricted", "sisyphus")]
    const skillTool = createSkillTool({
      directory: "/test",
      skills: loaded,
      commands: [],
      includeSkillsInDescription: true,
    })

    //#when
    await skillTool.execute({ name: "no-such-skill" }, mockContext).catch(() => "thrown")

    //#then
    expect(skillTool.description).toContain("freeze-public")
    expect(skillTool.description).not.toContain("freeze-restricted")
  })

  test("#when skills and commands seeded out of order #then description lists them sorted by name", () => {
    //#given unsorted input within the same scope
    const loaded = [createConfigSkill("zebra"), createConfigSkill("apple"), createConfigSkill("mango")]
    const commands = [createConfigCommand("zulu"), createConfigCommand("alpha")]

    //#when
    const skillTool = createSkillTool({
      directory: "/test",
      skills: loaded,
      commands,
      includeSkillsInDescription: true,
    })
    const desc = skillTool.description

    //#then sorted by name within the same scope
    expect(desc.indexOf("/apple")).toBeLessThan(desc.indexOf("/mango"))
    expect(desc.indexOf("/mango")).toBeLessThan(desc.indexOf("/zebra"))
    expect(desc.indexOf("/alpha")).toBeLessThan(desc.indexOf("/zulu"))
  })
})
