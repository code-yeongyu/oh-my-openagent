import { describe, expect, it } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createSkillTool } from "./tools"

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

describe("skill tool native miss diagnostics", () => {
  it("#given a host-native registry miss #when skill lookup fails #then diagnostics list checked registries without private paths", async () => {
    //#given
    const tool = createSkillTool({
      directory: "/test",
      skills: [],
      commands: [],
      nativeSkills: {
        all() { return [] },
        get() { return undefined },
        dirs() { return ["/private/host/skills"] },
      },
    })

    //#when
    const result = tool.execute({ name: "definitely-not-a-skill" }, mockContext)

    //#then
    await expect(result).rejects.toThrow("Checked registries: OMO static, project, user, host-native")
    await expect(result).rejects.toThrow("Host-native registry result: miss")
    await expect(result).rejects.not.toThrow("/private/host/skills")
  })

  it("#given a disabled host-native skill #when skill lookup reaches host-native #then diagnostics distinguish disabled from miss without leaking content", async () => {
    //#given
    const tool = createSkillTool({
      directory: "/test",
      skills: [],
      commands: [],
      disabledSkills: new Set(["blocked-native-skill"]),
      nativeSkills: {
        all() { return [] },
        get(name) {
          if (name !== "blocked-native-skill") return undefined
          return {
            name: "blocked-native-skill",
            description: "Blocked host-native skill",
            location: "/private/host/blocked-native-skill/SKILL.md",
            content: "SECRET_HOST_NATIVE_BODY",
          }
        },
        dirs() { return [] },
      },
    })

    //#when
    const result = tool.execute({ name: "blocked-native-skill" }, mockContext)

    //#then
    await expect(result).rejects.toThrow('Skill or command "blocked-native-skill" is disabled')
    await expect(result).rejects.toThrow("Host-native registry result: disabled by disabled_skills")
    await expect(result).rejects.not.toThrow("/private/host/blocked-native-skill/SKILL.md")
    await expect(result).rejects.not.toThrow("SECRET_HOST_NATIVE_BODY")
  })
})
