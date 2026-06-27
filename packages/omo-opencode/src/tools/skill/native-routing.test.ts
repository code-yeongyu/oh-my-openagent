import { describe, expect, mock, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import { createSkillTool } from "./tools"

function createConfigSkill(name: string): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: "Test template",
    },
    scope: "config",
  }
}

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "msg-1",
  agent: "test-agent",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

describe("skill tool native routing", () => {
  test("does not load native skills when a base skill matches", async () => {
    //#given
    const nativeAll = mock(() => [{
      name: "native-only-skill",
      description: "Native only skill",
      location: "/external/skills/native-only-skill/SKILL.md",
      content: "Native only skill body",
    }])
    const tool = createSkillTool({
      directory: "/test",
      skills: [createConfigSkill("base-skill")],
      nativeSkills: {
        all: nativeAll,
        get() { return undefined },
        dirs() { return [] },
      },
    })
    nativeAll.mockClear()

    //#when
    const result = await tool.execute({ name: "base-skill" }, mockContext)

    //#then
    expect(result).toContain("base-skill")
    expect(nativeAll).not.toHaveBeenCalled()
  })
})
