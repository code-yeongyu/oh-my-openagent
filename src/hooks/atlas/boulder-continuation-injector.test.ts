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

  test("uses raw agent key for promptAsync to avoid HTTP header issues", async () => {
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
    const result = await injectBoulderContinuation({
      ctx,
      sessionID: "ses_test_123",
      planName: "test-plan",
      remaining: 1,
      total: 2,
      agent: "atlas",
      sessionState: { promptFailureCount: 0 },
    })

    // then - uses raw agent key, not display name (to avoid HTTP header validation issues)
    expect(result).toBe("injected")
    expect(promptAsyncMock).toHaveBeenCalledTimes(1)
    expect(promptAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent: "atlas",
        }),
      }),
    )
  })

  test("#given background tasks are running #when injector checks again #then it reports skipped background tasks without mutating failure count", async () => {
    // given
    registerAgentName("atlas")
    const promptAsyncMock = mock(async (_request: unknown) => undefined)
    const messagesMock = mock(async () => ({ data: [] }))
    const sessionState = { promptFailureCount: 2, lastContinuationInjectedAt: 123 }

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
    const result = await injectBoulderContinuation({
      ctx,
      sessionID: "ses_test_123",
      planName: "test-plan",
      remaining: 1,
      total: 2,
      agent: "atlas",
      backgroundManager: {
        getTasksByParentSession: () => [{ status: "running" }],
      } as unknown as Parameters<typeof injectBoulderContinuation>[0]["backgroundManager"],
      sessionState,
    })

    // then
    expect(result).toBe("skipped_background_tasks")
    expect(promptAsyncMock).not.toHaveBeenCalled()
    expect(sessionState.promptFailureCount).toBe(2)
    expect(sessionState.lastContinuationInjectedAt).toBe(123)
  })

  test("#given the continuation agent is unavailable #when injector runs #then it reports skipped agent unavailable without prompting", async () => {
    // given
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
    const result = await injectBoulderContinuation({
      ctx,
      sessionID: "ses_test_123",
      planName: "test-plan",
      remaining: 1,
      total: 2,
      agent: "missing-agent",
      sessionState: { promptFailureCount: 0 },
    })

    // then
    expect(result).toBe("skipped_agent_unavailable")
    expect(promptAsyncMock).not.toHaveBeenCalled()
  })
})
