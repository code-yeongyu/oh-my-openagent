import { describe, expect, it, mock, afterAll } from "bun:test"
import { createTaskReflectionSuggesterHook } from "./hook"

let writtenSuggestions: Array<{ sessionID: string; toolCallCount: number; hadErrors: boolean }> = []

mock.module("./suggestion-writer", () => ({
  writeSuggestion: (args: { sessionID: string; toolCallCount: number; hadErrors: boolean }) => {
    writtenSuggestions.push(args)
  },
}))

afterAll(() => {
  mock.restore()
})

function makeIdleEvent(sessionID: string) {
  return { event: { type: "session.idle", properties: { sessionID } } }
}

function makeDeletedEvent(sessionID: string) {
  return { event: { type: "session.deleted", properties: { info: { id: sessionID } } } }
}

function makeErrorEvent(sessionID: string) {
  return { event: { type: "session.error", properties: { sessionID } } }
}

function makeToolCall(tool: string, sessionID: string) {
  return { tool, sessionID, callID: `call-${Math.random()}` }
}

describe("task-reflection-suggester hook", () => {
  describe("#given session with 5+ tool calls and no skill used", () => {
    describe("#when session.idle fires", () => {
      it("#then writes a skill suggestion", async () => {
        writtenSuggestions = []
        const hook = createTaskReflectionSuggesterHook()
        const sid = "ses-suggest-1"

        for (let i = 0; i < 5; i++) {
          await hook["tool.execute.after"](makeToolCall("bash", sid))
        }
        await hook.event(makeIdleEvent(sid))

        expect(writtenSuggestions).toHaveLength(1)
        expect(writtenSuggestions[0].sessionID).toBe(sid)
        expect(writtenSuggestions[0].toolCallCount).toBe(5)
      })
    })
  })

  describe("#given session with fewer than 5 tool calls", () => {
    describe("#when session.idle fires", () => {
      it("#then does not suggest", async () => {
        writtenSuggestions = []
        const hook = createTaskReflectionSuggesterHook()
        const sid = "ses-no-suggest-1"

        for (let i = 0; i < 4; i++) {
          await hook["tool.execute.after"](makeToolCall("read", sid))
        }
        await hook.event(makeIdleEvent(sid))

        expect(writtenSuggestions).toHaveLength(0)
      })
    })
  })

  describe("#given session where skill tool was used", () => {
    describe("#when session.idle fires with 5+ tool calls", () => {
      it("#then does not suggest (skill already guides the work)", async () => {
        writtenSuggestions = []
        const hook = createTaskReflectionSuggesterHook()
        const sid = "ses-skill-used-1"

        for (let i = 0; i < 5; i++) {
          await hook["tool.execute.after"](makeToolCall("bash", sid))
        }
        await hook["tool.execute.after"](makeToolCall("skill", sid))
        await hook.event(makeIdleEvent(sid))

        expect(writtenSuggestions).toHaveLength(0)
      })
    })
  })

  describe("#given session that already received a suggestion", () => {
    describe("#when session.idle fires again", () => {
      it("#then does not suggest twice", async () => {
        writtenSuggestions = []
        const hook = createTaskReflectionSuggesterHook()
        const sid = "ses-no-dup-1"

        for (let i = 0; i < 6; i++) {
          await hook["tool.execute.after"](makeToolCall("write", sid))
        }
        await hook.event(makeIdleEvent(sid))
        await hook.event(makeIdleEvent(sid))

        expect(writtenSuggestions).toHaveLength(1)
      })
    })
  })

  describe("#given session with session.error before idle", () => {
    describe("#when session.idle fires with 5+ tool calls", () => {
      it("#then suggestion includes hadErrors=true", async () => {
        writtenSuggestions = []
        const hook = createTaskReflectionSuggesterHook()
        const sid = "ses-errors-1"

        await hook.event(makeErrorEvent(sid))
        for (let i = 0; i < 5; i++) {
          await hook["tool.execute.after"](makeToolCall("bash", sid))
        }
        await hook.event(makeIdleEvent(sid))

        expect(writtenSuggestions).toHaveLength(1)
        expect(writtenSuggestions[0].hadErrors).toBe(true)
      })
    })
  })

  describe("#given session.deleted", () => {
    describe("#when same sessionID is reused", () => {
      it("#then suggestion can fire again (fresh state)", async () => {
        writtenSuggestions = []
        const hook = createTaskReflectionSuggesterHook()
        const sid = "ses-reuse-1"

        for (let i = 0; i < 5; i++) {
          await hook["tool.execute.after"](makeToolCall("bash", sid))
        }
        await hook.event(makeIdleEvent(sid))
        await hook.event(makeDeletedEvent(sid))

        for (let i = 0; i < 5; i++) {
          await hook["tool.execute.after"](makeToolCall("bash", sid))
        }
        await hook.event(makeIdleEvent(sid))

        expect(writtenSuggestions).toHaveLength(2)
      })
    })
  })
})
