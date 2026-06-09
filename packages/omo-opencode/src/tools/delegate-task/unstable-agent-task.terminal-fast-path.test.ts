/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { executeUnstableAgentTask } from "./unstable-agent-task"
import type { DelegateTaskArgs } from "./types"

const args: DelegateTaskArgs = {
  description: "terminal task",
  prompt: "do it",
  category: "quick",
  load_skills: [],
  run_in_background: false,
}

describe("executeUnstableAgentTask terminal fast path", () => {
  test("#given launched task is already interrupted #when monitoring starts #then it returns without waiting for the poll interval", async () => {
    // given
    const startedAt = Date.now()

    // when
    const output = await executeUnstableAgentTask(
      args,
      {
        sessionID: "ses_parent",
        messageID: "msg_parent",
        agent: "sisyphus",
        abort: new AbortController().signal,
      },
      unsafeTestValue({
        manager: {
          launch: async () => ({
            id: "bg_terminal",
            sessionId: "ses_terminal",
            description: "terminal task",
            agent: "sisyphus-junior",
            status: "interrupt",
            error: "already stopped",
          }),
          getTask: () => ({
            id: "bg_terminal",
            sessionId: "ses_terminal",
            description: "terminal task",
            agent: "sisyphus-junior",
            status: "interrupt",
            error: "already stopped",
          }),
        },
        client: {
          session: {
            status: async () => ({ data: {} }),
            messages: async () => ({ data: [] }),
          },
        },
      }),
      { sessionID: "ses_parent", messageID: "msg_parent", agent: "sisyphus" },
      "sisyphus-junior",
      undefined,
      undefined,
      "test-model",
    )

    // then
    expect(Date.now() - startedAt).toBeLessThan(200)
    expect(output).toContain("SUPERVISED TASK FAILED")
    expect(output).toContain("already stopped")
  })
})
