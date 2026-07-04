import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { restoreModuleMocksForTestFile } from "../../../testing/module-mock-lifecycle"

const executeStopHooks = mock(async (context: { parentSessionId?: string; transcriptPath?: string }) => ({
  block: false,
  observedParentSessionId: context.parentSessionId,
}))

mock.module("../config", () => ({
  clearClaudeHooksConfigCache: () => {},
  loadClaudeHooksConfig: async () => null,
}))

mock.module("../config-loader", () => ({
  clearPluginExtendedConfigCache: () => {},
  loadPluginExtendedConfig: async () => ({}),
}))

mock.module("../stop", () => ({
  executeStopHooks,
}))

afterAll(() => {
  mock.restore()
  restoreModuleMocksForTestFile(import.meta.url)
})

const { createSessionEventHandler } = await import("./session-event-handler")

describe("createSessionEventHandler retry behavior", () => {
  beforeEach(() => {
    executeStopHooks.mockClear()
  })

  test("#given transient parent lookup failure #when the next idle succeeds #then stop hooks receive the later parent session id", async () => {
    //#given
    let getCallCount = 0
    const handler = createSessionEventHandler(
      {
        directory: "/repo",
        client: {
          session: {
            get: async () => {
              getCallCount += 1
              if (getCallCount === 1) {
                throw new Error("temporary failure")
              }
              return { data: { parentID: "ses_parent" } }
            },
            prompt: async () => undefined,
          },
        },
      } as never,
      {},
    )

    //#when
    await handler({ event: { type: "session.idle", properties: { sessionID: "ses_retry" } } })
    await handler({ event: { type: "session.idle", properties: { sessionID: "ses_retry" } } })

    //#then
    expect(getCallCount).toBe(2)
    expect(executeStopHooks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parentSessionId: "ses_parent",
      }),
      null,
      {},
    )
  })

  test("#given parent lookup throws a non-Error value #when the next idle succeeds #then stop hooks receive the later parent session id", async () => {
    //#given
    let getCallCount = 0
    const thrownValue = "temporary failure"
    const handler = createSessionEventHandler(
      {
        directory: "/repo",
        client: {
          session: {
            get: async () => {
              getCallCount += 1
              if (getCallCount === 1) {
                throw thrownValue
              }
              return { data: { parentID: "ses_parent" } }
            },
            prompt: async () => undefined,
          },
        },
      } as never,
      {},
    )

    //#when
    await handler({ event: { type: "session.idle", properties: { sessionID: "ses_retry_non_error" } } })
    await handler({ event: { type: "session.idle", properties: { sessionID: "ses_retry_non_error" } } })

    //#then
    expect(getCallCount).toBe(2)
    expect(executeStopHooks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parentSessionId: "ses_parent",
      }),
      null,
      {},
    )
  })

  test("#given a parentless idle session #when stop hooks execute #then the context carries the session transcript path", async () => {
    //#given
    const handler = createSessionEventHandler(
      {
        directory: "/repo",
        client: {
          session: {
            get: async () => ({ data: {} }),
            prompt: async () => undefined,
          },
        },
      } as never,
      {},
    )

    //#when
    await handler({
      event: { type: "session.idle", properties: { sessionID: "ses_retry_transcript" } },
    })

    //#then
    expect(executeStopHooks).toHaveBeenCalledTimes(1)
    const stopContext = executeStopHooks.mock.calls[0]?.[0]
    const { getTranscriptPath } = await import("../transcript")
    expect(stopContext?.transcriptPath).toBe(getTranscriptPath("ses_retry_transcript"))
  })
})
