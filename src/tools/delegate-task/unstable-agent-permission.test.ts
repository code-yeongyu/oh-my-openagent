import { describe, expect, test } from "bun:test"

import { executeUnstableAgentTask } from "./unstable-agent-task"

describe("executeUnstableAgentTask session permission", () => {
  test("passes question-deny session permission into background launch", async () => {
    // given
    const launchCalls: Array<Record<string, unknown>> = []
    const mockManager = {
      launch: async (input: Record<string, unknown>) => {
        launchCalls.push(input)
        return {
          id: "bg_unstable_permission",
          sessionID: "ses_unstable_permission",
          description: "test task",
          agent: "sisyphus-junior",
          status: "running",
        }
      },
      getTask: () => ({
        id: "bg_unstable_permission",
        sessionID: "ses_unstable_permission",
        status: "interrupt",
        description: "test task",
        agent: "sisyphus-junior",
        error: "stop after launch",
      }),
    }
    const toolContext = {
      sessionID: "parent-session",
      messageID: "msg_parent",
      agent: "sisyphus",
      metadata: () => {},
      abort: new AbortController().signal,
    } satisfies Parameters<typeof executeUnstableAgentTask>[1]
    const executorContext = {
      manager: mockManager,
      client: {
        session: {
          status: async () => ({ data: {} }),
          messages: async () => ({ data: [] }),
        },
      },
    } as unknown as Parameters<typeof executeUnstableAgentTask>[2]
    const parentContext = {
      sessionID: "parent-session",
      messageID: "msg_parent",
    } satisfies Parameters<typeof executeUnstableAgentTask>[3]

    // when
    await executeUnstableAgentTask(
      {
        prompt: "test prompt",
        description: "test task",
        category: "test",
        load_skills: [],
        run_in_background: false,
      },
      toolContext,
      executorContext,
      parentContext,
      "sisyphus-junior",
      undefined,
      undefined,
      "test-model",
    )

    // then
    expect(launchCalls).toHaveLength(1)
    expect(launchCalls[0]?.sessionPermission).toEqual([
      { permission: "question", action: "deny", pattern: "*" },
    ])
  })
})
