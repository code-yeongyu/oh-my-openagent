import { describe, expect, test, mock, beforeEach } from "bun:test"
import type { LoadedSkill } from "../../features/opencode-skill-loader/types"

const mockWriteBoomerang = mock(() => {})
mock.module("./memory-writer", () => ({ writeBoomerang: mockWriteBoomerang }))

const { createSkillBoomerangHook } = await import("./hook")

function makeSkill(name: string, memoryTags: string[] = []): LoadedSkill {
  return { name, scope: "project", definition: { description: name }, memoryTags } as unknown as LoadedSkill
}

beforeEach(() => {
  mockWriteBoomerang.mockClear()
})

describe("createSkillBoomerangHook", () => {
  describe("#given a skill invocation followed by tool calls", () => {
    test("#when session.idle fires #then boomerang written with captured tools", async () => {
      //#given
      const hook = createSkillBoomerangHook([makeSkill("git-master", ["git"])])

      //#when
      await hook["tool.execute.before"]({ tool: "skill", callID: "c1", sessionID: "s1" }, { args: { name: "git-master" } })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: "s1", callID: "c1" }, { title: "skill: git-master" })
      await hook["tool.execute.after"]({ tool: "bash", sessionID: "s1", callID: "c2" }, { title: "$ git commit" })
      await hook["tool.execute.after"]({ tool: "edit", sessionID: "s1", callID: "c3" }, { title: "Edit src/auth.ts" })
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } })

      //#then
      expect(mockWriteBoomerang).toHaveBeenCalledTimes(1)
      const call = mockWriteBoomerang.mock.calls[0][0]
      expect(call.skillName).toBe("git-master")
      expect(call.memoryTags).toEqual(["git"])
      expect(call.toolCalls).toHaveLength(2)
      expect(call.toolCalls[0]).toEqual({ tool: "bash", target: "$ git commit" })
      expect(call.toolCalls[1]).toEqual({ tool: "edit", target: "Edit src/auth.ts" })
    })
  })

  describe("#given session.idle fires twice", () => {
    test("#when same window #then only one write (dedup)", async () => {
      //#given
      const hook = createSkillBoomerangHook([makeSkill("git-master")])

      //#when
      await hook["tool.execute.before"]({ tool: "skill", callID: "c1", sessionID: "s2" }, { args: { name: "git-master" } })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: "s2", callID: "c1" }, undefined)
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "s2" } } })
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "s2" } } })

      //#then
      expect(mockWriteBoomerang).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given a second skill invoked before idle", () => {
    test("#when first window still open #then first is flushed before second opens", async () => {
      //#given
      const hook = createSkillBoomerangHook([makeSkill("git-master"), makeSkill("playwright", ["browser"])])
      const s = "s3"

      //#when — first skill
      await hook["tool.execute.before"]({ tool: "skill", callID: "c1", sessionID: s }, { args: { name: "git-master" } })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: s, callID: "c1" }, undefined)
      await hook["tool.execute.after"]({ tool: "bash", sessionID: s, callID: "c2" }, { title: "$ git log" })

      //#when — second skill rotates window
      await hook["tool.execute.before"]({ tool: "skill", callID: "c3", sessionID: s }, { args: { name: "playwright" } })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: s, callID: "c3" }, undefined)

      //#then — first window flushed on rotation
      expect(mockWriteBoomerang).toHaveBeenCalledTimes(1)
      expect(mockWriteBoomerang.mock.calls[0][0].skillName).toBe("git-master")

      //#when — idle closes second window
      await hook.event({ event: { type: "session.idle", properties: { sessionID: s } } })

      //#then — second window flushed
      expect(mockWriteBoomerang).toHaveBeenCalledTimes(2)
      expect(mockWriteBoomerang.mock.calls[1][0].skillName).toBe("playwright")
    })
  })

  describe("#given max window size", () => {
    test("#when 35 tool calls after skill #then only 30 captured", async () => {
      //#given
      const hook = createSkillBoomerangHook([makeSkill("git-master")])
      const s = "s4"

      //#when
      await hook["tool.execute.before"]({ tool: "skill", callID: "c1", sessionID: s }, { args: { name: "git-master" } })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: s, callID: "c1" }, undefined)
      for (let i = 0; i < 35; i++) {
        await hook["tool.execute.after"]({ tool: "bash", sessionID: s, callID: `cx${i}` }, { title: `$ cmd ${i}` })
      }
      await hook.event({ event: { type: "session.idle", properties: { sessionID: s } } })

      //#then
      expect(mockWriteBoomerang).toHaveBeenCalledTimes(1)
      expect(mockWriteBoomerang.mock.calls[0][0].toolCalls).toHaveLength(30)
    })
  })

  describe("#given session.deleted fires", () => {
    test("#when window open #then flush and cleanup", async () => {
      //#given
      const hook = createSkillBoomerangHook([makeSkill("git-master")])
      const s = "s5"

      //#when
      await hook["tool.execute.before"]({ tool: "skill", callID: "c1", sessionID: s }, { args: { name: "git-master" } })
      await hook["tool.execute.after"]({ tool: "skill", sessionID: s, callID: "c1" }, undefined)
      await hook.event({ event: { type: "session.deleted", properties: { info: { id: s } } } })

      //#then
      expect(mockWriteBoomerang).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given non-skill tool before skill invocation", () => {
    test("#when bash fires with no open window #then nothing captured", async () => {
      //#given
      const hook = createSkillBoomerangHook([])

      //#when
      await hook["tool.execute.after"]({ tool: "bash", sessionID: "s6", callID: "c1" }, { title: "$ ls" })
      await hook.event({ event: { type: "session.idle", properties: { sessionID: "s6" } } })

      //#then
      expect(mockWriteBoomerang).not.toHaveBeenCalled()
    })
  })
})
