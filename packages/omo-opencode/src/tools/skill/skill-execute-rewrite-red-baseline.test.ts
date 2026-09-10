import { describe, expect, mock, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
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

const mockContext: ToolContext = {
  sessionID: "red-baseline-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("#given skill tool description freeze", () => {
  test("#when execute runs after description was seeded #then description bytes are unchanged", async () => {
    //#given
    const loaded = [createConfigSkill("red-public"), createConfigSkill("red-restricted", "sisyphus")]
    const skillTool = createSkillTool({
      directory: "/test",
      skills: loaded,
      commands: [],
      getLoadedSkills: mock(async () => [...loaded]),
      includeSkillsInDescription: true,
    })
    const before = skillTool.description

    //#when
    await skillTool.execute({ name: "no-such-skill" }, mockContext).catch(() => "thrown")

    //#then
    expect(skillTool.description).toBe(before)
  })
})
