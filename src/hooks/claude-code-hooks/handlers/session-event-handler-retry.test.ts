const { beforeEach, describe, expect, mock, test, afterAll } = require("bun:test")

const executeStopHooks = mock(async (context: { parentSessionId?: string }) => ({
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

afterAll(() => { mock.restore() })

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
})

export {}
