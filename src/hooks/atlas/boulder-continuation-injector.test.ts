import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { registerAgentName, _resetForTesting } from "../../features/claude-code-session-state"
import { injectBoulderContinuation } from "./boulder-continuation-injector"

describe("injectBoulderContinuation", () => {
  beforeEach(() => {
    // given
    _resetForTesting()
  })

  afterEach(() => {
    // then
    _resetForTesting()
  })

  test("normalizes config-key agent to display-name for promptAsync", async () => {
    // given
    registerAgentName("atlas")
    const promptAsyncMock = mock(async (_request: unknown) => undefined)
    const messagesMock = mock(async () => ({ data: [] }))

    const ctx = {
      directory: "/tmp",
      client: {
        session: {
          messages: messagesMock,
          promptAsync: promptAsyncMock,
        },
      },
    } as unknown as PluginInput

    // when
    await injectBoulderContinuation({
      ctx,
      sessionID: "ses_test_123",
      planName: "test-plan",
      remaining: 1,
      total: 2,
      agent: "atlas",
      sessionState: { promptFailureCount: 0 },
    })

    // then
    expect(promptAsyncMock).toHaveBeenCalledTimes(1)
    expect(promptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent: "Atlas (Plan Executor)",
        }),
      }),
    )
  })
})
