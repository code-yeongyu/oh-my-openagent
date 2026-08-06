/// <reference types="bun-types" />

import { beforeEach, describe, expect, it } from "bun:test"

import { clearPendingStore } from "../features/tool-metadata-store"
import { createToolExecuteAfterHandler } from "./tool-execute-after"

let logMessages: string[] = []

function logForTesting(message: string): void {
  logMessages.push(message)
}

function hasLogMessageContaining(expected: string): boolean {
  return logMessages.some((message) => message.includes(expected))
}

describe("createToolExecuteAfterHandler metadata recovery", () => {
  beforeEach(() => {
    clearPendingStore()
    logMessages = []
  })

  it("#given builtin tool has no recoverable metadata #when tool.execute.after runs #then it fails open without warning spam", async () => {
    // given
    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {} as never,
      log: logForTesting,
    })
    const output = { title: "result", output: "read output", metadata: {} }

    // when
    await handler(
      { tool: "read", sessionID: "ses_parent", callID: "call_read" },
      output,
    )

    // then
    expect(output).toEqual({ title: "result", output: "read output", metadata: {} })
    expect(hasLogMessageContaining("Unable to recover stored metadata")).toBe(false)
  })

  it("#given call_omo_agent has no recoverable store entry #when tool.execute.after runs #then it fails open without warning spam", async () => {
    // given
    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {} as never,
      log: logForTesting,
    })
    const output = { title: "result", output: "agent output", metadata: {} }

    // when
    await handler(
      { tool: "call_omo_agent", sessionID: "ses_parent", callID: "call_agent" },
      output,
    )

    // then
    expect(output).toEqual({ title: "result", output: "agent output", metadata: {} })
    expect(hasLogMessageContaining("Unable to recover stored metadata")).toBe(false)
  })

  it("#given metadata-linked tool has stale metadata #when tool.execute.after runs #then it warns and still completes hooks", async () => {
    // given
    let hookRan = false
    const handler = createToolExecuteAfterHandler({
      ctx: { directory: "/repo" } as never,
      hooks: {
        categorySkillReminder: {
          "tool.execute.after": async () => {
            hookRan = true
          },
        },
      } as never,
      log: logForTesting,
    })

    // when
    await handler(
      { tool: "task", sessionID: "ses_parent", callID: "call_missing" },
      { title: "result", output: "task output", metadata: {} },
    )

    // then
    expect(hookRan).toBe(true)
    expect(hasLogMessageContaining("Unable to recover stored metadata and no native session linkage was present")).toBe(true)
  })
})
