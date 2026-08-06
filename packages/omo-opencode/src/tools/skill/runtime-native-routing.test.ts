import { describe, expect, mock, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"
import { createSkillTool } from "./tools"

function createConfigSkill(name: string, body = `Body for ${name}`): LoadedSkill {
  return {
    name,
    path: `/test/skills/${name}/SKILL.md`,
    definition: {
      name,
      description: `Test skill ${name}`,
      template: `<skill-instruction>${body}</skill-instruction>`,
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

describe("skill tool runtime and native routing", () => {
  test("loads a plugin-registered runtime skill through getLoadedSkills", async () => {
    const runtimeSkill = createConfigSkill("plugin-registered-skill", "Runtime plugin body")
    const getLoadedSkills = mock(async () => [runtimeSkill])
    const tool = createSkillTool({
      directory: "/test",
      skills: [],
      commands: [],
      getLoadedSkills,
    })

    const result = await tool.execute({ name: "plugin-registered-skill" }, mockContext)

    expect(getLoadedSkills).toHaveBeenCalled()
    expect(result).toContain("## Skill: plugin-registered-skill")
    expect(result).toContain("Runtime plugin body")
  })

  test("does not call native skills when a runtime/base skill matches", async () => {
    const nativeAll = mock(() => [{
      name: "native-only-skill",
      description: "Native only skill",
      location: "/external/skills/native-only-skill/SKILL.md",
      content: "Native only skill body",
    }])
    const tool = createSkillTool({
      directory: "/test",
      skills: [createConfigSkill("base-skill")],
      commands: [],
      nativeSkills: {
        all: nativeAll,
        get() { return undefined },
        dirs() { return [] },
      },
    })
    nativeAll.mockClear()

    const result = await tool.execute({ name: "base-skill" }, mockContext)

    expect(result).toContain("## Skill: base-skill")
    expect(nativeAll).not.toHaveBeenCalled()
  })

  test("falls back to native OpenCode skills after runtime/base miss", async () => {
    const nativeAll = mock(async () => [{
      name: "user-normal-skill",
      description: "User normal-path skill",
      location: "/external/skills/user-normal-skill/SKILL.md",
      content: "User normal skill body",
    }])
    const tool = createSkillTool({
      directory: "/test",
      skills: [],
      commands: [],
      nativeSkills: {
        all: nativeAll,
        async get() { return undefined },
        async dirs() { return [] },
      },
    })

    const result = await tool.execute({ name: "user-normal-skill" }, mockContext)

    expect(nativeAll).toHaveBeenCalled()
    expect(result).toContain("## Skill: user-normal-skill")
    expect(result).toContain("User normal skill body")
  })
})
