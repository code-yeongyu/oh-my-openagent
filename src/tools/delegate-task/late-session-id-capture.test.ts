const { describe, test, expect } = require("bun:test")

import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import type { ParentContext } from "./executor-types"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

const MODEL = { providerID: "anthropic", modelID: "claude-sonnet-4-6" }

function makeMockCtx(): ToolContextWithMetadata & { captured: any[] } {
  const captured: any[] = []
  return {
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "sisyphus",
    abort: new AbortController().signal,
    callID: "call_001",
    metadata: async (input: any) => { captured.push(input) },
    captured,
  }
}

const parentContext: ParentContext = {
  sessionID: "ses_parent",
  messageID: "msg_parent",
  agent: "sisyphus",
  model: MODEL,
}

describe("background-task late sessionId capture (issue #4252)", () => {
  test("#given launch returns no sessionId and getTask returns one #when publishing metadata #then sessionId is captured so TUI entry is clickable", async () => {
    const { executeBackgroundTask } = require("./background-task")
    const ctx = makeMockCtx()
    const args: DelegateTaskArgs = {
      description: "deferred task",
      prompt: "do it",
      load_skills: [],
      run_in_background: true,
      subagent_type: "explore",
    }

    // launch returns a pending task with no sessionId; getTask returns the
    // same task with sessionId populated *after* the wait loop exits. This
    // simulates the race where the subagent session is created moments after
    // we stop polling, and is the exact condition that left the OpenCode TUI
    // session entry stuck spinning with no click target on v4.2.3.
    await executeBackgroundTask(args, ctx, unsafeTestValue({
      manager: {
        launch: async () => ({
          id: "bg_late",
          description: "deferred task",
          agent: "explore",
          status: "pending",
        }),
        getTask: () => ({
          id: "bg_late",
          description: "deferred task",
          agent: "explore",
          status: "running",
          sessionId: "ses_late",
        }),
      },
    }), parentContext, "explore", MODEL, undefined)

    const meta = ctx.captured.find((m: any) => m.metadata?.sessionId)
    expect(meta).toBeDefined()
    expect(meta.metadata.sessionId).toBe("ses_late")
    expect(meta.metadata.taskId).toBe("ses_late")
    expect(meta.metadata.backgroundTaskId).toBe("bg_late")
  })
})
