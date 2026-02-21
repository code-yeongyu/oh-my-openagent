import { describe, test, expect, beforeEach } from "bun:test"
import { createTaskReminderHook } from "./index"
import type { PluginInput } from "@opencode-ai/plugin"

const mockCtx = {} as PluginInput

describe("TaskReminderHook", () => {
  let hook: ReturnType<typeof createTaskReminderHook>

  beforeEach(() => {
    hook = createTaskReminderHook(mockCtx)
  })

  test("does not inject reminder before 10 turns", async () => {
    //#given
    const sessionID = "test-session"
    const output = { output: "Result" }

    //#when
    for (let i = 0; i < 9; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID, callID: `call-${i}` },
        output
      )
    }

    //#then
    expect(output.output).not.toContain("task tools haven't been used")
  })

  test("injects reminder after 10 turns without task tool usage", async () => {
    //#given
    const sessionID = "test-session"
    const output = { output: "Result" }

    //#when
    for (let i = 0; i < 10; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID, callID: `call-${i}` },
        output
      )
    }

    //#then
    expect(output.output).toContain("task tools haven't been used")
  })

  test("resets counter when task tool is used", async () => {
    //#given
    const sessionID = "test-session"
    const output = { output: "Result" }

    //#when
    for (let i = 0; i < 5; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID, callID: `call-${i}` },
        output
      )
    }
    await hook["tool.execute.after"]?.(
      { tool: "task", sessionID, callID: "call-task" },
      output
    )
    for (let i = 0; i < 9; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID, callID: `call-after-${i}` },
        output
      )
    }

    //#then
    expect(output.output).not.toContain("task tools haven't been used")
  })

  test("resets counter after injecting reminder", async () => {
    //#given
    const sessionID = "test-session"
    const output1 = { output: "Result 1" }
    const output2 = { output: "Result 2" }

    //#when
    for (let i = 0; i < 10; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID, callID: `call-1-${i}` },
        output1
      )
    }
    for (let i = 0; i < 9; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID, callID: `call-2-${i}` },
        output2
      )
    }

    //#then
    expect(output1.output).toContain("task tools haven't been used")
    expect(output2.output).not.toContain("task tools haven't been used")
  })

  test("tracks separate counters per session", async () => {
    //#given
    const session1 = "session-1"
    const session2 = "session-2"
    const output1 = { output: "Result 1" }
    const output2 = { output: "Result 2" }

    //#when
    for (let i = 0; i < 10; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID: session1, callID: `call-${i}` },
        output1
      )
    }
    for (let i = 0; i < 5; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID: session2, callID: `call-${i}` },
        output2
      )
    }

    //#then
    expect(output1.output).toContain("task tools haven't been used")
    expect(output2.output).not.toContain("task tools haven't been used")
  })

  test("cleans up counters on session.deleted", async () => {
    //#given
    const sessionID = "test-session"
    const output = { output: "Result" }

    //#when
    for (let i = 0; i < 10; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID, callID: `call-${i}` },
        output
      )
    }
    await hook.event?.({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } })
    const outputAfterDelete = { output: "Result" }
    for (let i = 0; i < 9; i++) {
      await hook["tool.execute.after"]?.(
        { tool: "bash", sessionID, callID: `call-after-${i}` },
        outputAfterDelete
      )
    }

    //#then
    expect(outputAfterDelete.output).not.toContain("task tools haven't been used")
  })
})
