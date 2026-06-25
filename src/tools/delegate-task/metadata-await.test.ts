const { describe, test, expect } = require("bun:test")

import { executeBackgroundTask } from "./executor"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"

describe("task tool metadata awaiting", () => {
  test("executeBackgroundTask awaits ctx.metadata before returning", async () => {
    // given
    let metadataResolved = false
    const abort = new AbortController()

    const ctx: ToolContextWithMetadata = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
      agent: "morpheus",
      abort: abort.signal,
      metadata: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
        metadataResolved = true
      },
    }

    const args: DelegateTaskArgs = {
      load_skills: [],
      description: "Test task",
      prompt: "Do something",
      run_in_background: true,
      subagent_type: "trinity",
    }

    const executorCtx = {
      manager: {
        launch: async () => ({
          id: "task_1",
          description: "Test task",
          prompt: "Do something",
          agent: "trinity",
          status: "pending",
          sessionID: "ses_child",
        }),
        getTask: () => undefined,
      },
    } as unknown as Record<string, unknown>

    const parentContext = {
      sessionID: "ses_parent",
      messageID: "msg_parent",
    }

    // when
    const result = await executeBackgroundTask(
      args,
      ctx,
      executorCtx,
      parentContext,
      "trinity",
      undefined,
      undefined,
    )

    // then
    expect(result).toContain("Background task launched")
    expect(metadataResolved).toBe(true)
  })
})
