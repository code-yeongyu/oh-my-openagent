import { describe, expect, test, mock, beforeEach } from "bun:test"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

// Mock memory-writer before importing the hook
const mockWriteSkillUsage = mock(() => {})
mock.module("./memory-writer", () => ({ writeSkillUsage: mockWriteSkillUsage }))

const { createSkillUsageTrackerHook } = await import("./hook")

function makeSkill(overrides: Partial<LoadedSkill> = {}): LoadedSkill {
  return {
    name: "test-skill",
    scope: "project",
    definition: { description: "Test skill" },
    ...overrides,
  } as unknown as LoadedSkill
}

beforeEach(() => {
  mockWriteSkillUsage.mockClear()
})

describe("createSkillUsageTrackerHook", () => {
  describe("#given a skill tool call", () => {
    test("#when before fires, #then stores callID → skillName", async () => {
      //#given
      const hook = createSkillUsageTrackerHook([makeSkill()])
      const input = { tool: "skill", callID: "call-1" }
      const output = { args: { name: "test-skill" } }

      //#when
      await hook["tool.execute.before"](input, output)
      await hook["tool.execute.after"]({ tool: "skill", sessionID: "ses-1", callID: "call-1" })

      //#then
      expect(mockWriteSkillUsage).toHaveBeenCalledTimes(1)
      expect(mockWriteSkillUsage).toHaveBeenCalledWith({
        skillName: "test-skill",
        sessionID: "ses-1",
        memoryTags: [],
      })
    })

    test("#when skill has memoryTags, #then passes them through", async () => {
      //#given
      const skill = makeSkill({ name: "docker-ops", memoryTags: ["docker", "container"] })
      const hook = createSkillUsageTrackerHook([skill])

      //#when
      await hook["tool.execute.before"](
        { tool: "skill", callID: "call-2" },
        { args: { name: "docker-ops" } },
      )
      await hook["tool.execute.after"]({ tool: "skill", sessionID: "ses-1", callID: "call-2" })

      //#then
      expect(mockWriteSkillUsage).toHaveBeenCalledWith({
        skillName: "docker-ops",
        sessionID: "ses-1",
        memoryTags: ["docker", "container"],
      })
    })
  })

  describe("#given a non-skill tool call", () => {
    test("#when before fires with non-skill tool, #then nothing stored", async () => {
      //#given
      const hook = createSkillUsageTrackerHook([])

      //#when
      await hook["tool.execute.before"](
        { tool: "bash", callID: "call-3" },
        { args: { command: "ls" } },
      )
      await hook["tool.execute.after"]({ tool: "bash", sessionID: "ses-1", callID: "call-3" })

      //#then
      expect(mockWriteSkillUsage).not.toHaveBeenCalled()
    })

    test("#when after fires for non-skill tool, #then no write", async () => {
      //#given
      const hook = createSkillUsageTrackerHook([])

      //#when
      await hook["tool.execute.after"]({ tool: "read", sessionID: "ses-1", callID: "call-4" })

      //#then
      expect(mockWriteSkillUsage).not.toHaveBeenCalled()
    })
  })

  describe("#given callID correlation", () => {
    test("#when after fires without matching before, #then no write", async () => {
      //#given
      const hook = createSkillUsageTrackerHook([makeSkill()])

      //#when — after without before
      await hook["tool.execute.after"]({ tool: "skill", sessionID: "ses-1", callID: "orphan" })

      //#then
      expect(mockWriteSkillUsage).not.toHaveBeenCalled()
    })

    test("#when two skill calls interleaved, #then each resolves independently", async () => {
      //#given
      const skills = [makeSkill({ name: "skill-a" }), makeSkill({ name: "skill-b" })]
      const hook = createSkillUsageTrackerHook(skills)

      //#when — before both, then after both
      await hook["tool.execute.before"]({ tool: "skill", callID: "c1" }, { args: { name: "skill-a" } })
      await hook["tool.execute.before"]({ tool: "skill", callID: "c2" }, { args: { name: "skill-b" } })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: "ses-1", callID: "c1" })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: "ses-1", callID: "c2" })

      //#then
      expect(mockWriteSkillUsage).toHaveBeenCalledTimes(2)
      const calls = mockWriteSkillUsage.mock.calls
      expect(calls[0][0].skillName).toBe("skill-a")
      expect(calls[1][0].skillName).toBe("skill-b")
    })

    test("#when after fires twice for same callID, #then second write skipped", async () => {
      //#given
      const hook = createSkillUsageTrackerHook([makeSkill()])

      //#when
      await hook["tool.execute.before"]({ tool: "skill", callID: "c5" }, { args: { name: "test-skill" } })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: "ses-1", callID: "c5" })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: "ses-1", callID: "c5" })

      //#then — second after finds no pending entry
      expect(mockWriteSkillUsage).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given subscriptions field", () => {
    test("#when hook created, #then subscriptions includes both events", () => {
      //#given
      const hook = createSkillUsageTrackerHook([])

      //#then
      expect(hook.subscriptions).toContain("tool.execute.before")
      expect(hook.subscriptions).toContain("tool.execute.after")
    })
  })
})
