import { describe, expect, test } from "bun:test"

import { executeBackgroundContinuation } from "./background-continuation"
import { backgroundLaunchFollowUp } from "./background-launch-follow-up"
import { executeBackgroundTask } from "./executor"
import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

const task = {
  id: "bg_1",
  description: "Test task",
  prompt: "Do something",
  agent: "explore",
  status: "pending",
  sessionId: "ses_child",
}

const ctx: ToolContextWithMetadata = {
  sessionID: "ses_parent",
  messageID: "msg_parent",
  agent: "sisyphus",
  abort: new AbortController().signal,
  metadata: async () => {},
}

const parentContext = { sessionID: "ses_parent", messageID: "msg_parent", agent: "sisyphus" }

function argsFor(wake: DelegateTaskArgs["wake"], taskId?: string): DelegateTaskArgs {
  return {
    load_skills: [],
    description: "Test task",
    prompt: "Do something",
    run_in_background: true,
    subagent_type: "explore",
    ...(wake ? { wake } : {}),
    ...(taskId ? { task_id: taskId } : {}),
  }
}

describe("background launch follow-up", () => {
  describe("#given the two wake modes", () => {
    test("#then each gets its own follow-up", () => {
      expect(backgroundLaunchFollowUp("none")).not.toBe(backgroundLaunchFollowUp("each"))
      expect(backgroundLaunchFollowUp(undefined)).toBe(backgroundLaunchFollowUp("each"))
    })
  })

  for (const wake of ["none", "each"] as const) {
    const other = wake === "none" ? "each" : "none"

    describe(`#given a launch with wake "${wake}"`, () => {
      test("#when a new background task starts #then its result text carries that wake's follow-up", async () => {
        // when
        const result = await executeBackgroundTask(
          argsFor(wake),
          ctx,
          unsafeTestValue({ manager: { launch: async () => task, getTask: () => undefined } }),
          parentContext,
          "explore",
          undefined,
          undefined,
        )

        // then
        expect(result).toContain(backgroundLaunchFollowUp(wake))
        expect(result).not.toContain(backgroundLaunchFollowUp(other))
      })

      test("#when a background task is continued #then its result text carries that wake's follow-up", async () => {
        // when
        const result = await executeBackgroundContinuation(
          argsFor(wake, "ses_child"),
          ctx,
          unsafeTestValue({ manager: { resume: async () => ({ ...task, status: "running" }) } }),
          parentContext,
        )

        // then
        expect(result).toContain(backgroundLaunchFollowUp(wake))
        expect(result).not.toContain(backgroundLaunchFollowUp(other))
      })
    })
  }
})
