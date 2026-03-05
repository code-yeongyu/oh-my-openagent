/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test"

import { CHECKPOINT_MESSAGE_THRESHOLD } from "./constants"

const logMock = mock(() => {})

mock.module("../../shared", () => ({
  createInternalAgentTextPart: (text: string) => ({ type: "text", text }),
  normalizeSDKResponse: (resp: unknown, fallback: unknown) => (Array.isArray(resp) ? resp : fallback),
  log: () => {},
}))
mock.module("../../shared/logger", () => ({ log: logMock }))
mock.module("../../shared/agent-display-names", () => ({
  getAgentConfigKey: (name: string) => name.toLowerCase(),
}))

type Hook = { event: (input: { event: { type: string; properties?: unknown } }) => Promise<void> }
type Message = { info?: { agent?: string } }

describe("createAutoCheckpointHook", () => {
  const realNow = Date.now
  let now = 1_000
  let createAutoCheckpointHook: typeof import("./hook").createAutoCheckpointHook
  let promptAsync: ReturnType<typeof mock<(input: unknown) => Promise<void>>>
  let messages: ReturnType<typeof mock<() => Promise<Message[]>>>
  let ctx: { client: { session: { messages: typeof messages; promptAsync: typeof promptAsync } }; directory: string }
  let hook: Hook

  const emitIdle = async (sessionID: string): Promise<void> => {
    await hook.event({ event: { type: "session.idle", properties: { sessionID } } })
  }

  const emitDeleted = async (sessionID: string): Promise<void> => {
    await hook.event({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } })
  }

  beforeEach(async () => {
    ;({ createAutoCheckpointHook } = await import("./hook"))
    now = 1_000
    Date.now = () => now
    logMock.mockClear()
    messages = mock(async () => [{ info: { agent: "sisyphus" } }])
    promptAsync = mock(async () => {})
    ctx = { client: { session: { messages, promptAsync } }, directory: "/tmp/test" }
    hook = createAutoCheckpointHook(ctx as never)
  })

  test("#given fresh session #when first idle #then injects restore prompt", async () => {
    await emitIdle("ses-1")
    expect(promptAsync).toHaveBeenCalledTimes(1)
    Date.now = realNow
  })

  test("#given restored session #when second idle below threshold #then does not inject", async () => {
    await emitIdle("ses-1")
    now += 6 * 60 * 1000
    await emitIdle("ses-1")
    expect(promptAsync).toHaveBeenCalledTimes(1)
    Date.now = realNow
  })

  test("#given session with many idles #when message threshold reached #then injects checkpoint", async () => {
    await emitIdle("ses-1")
    now += 6 * 60 * 1000
    for (let i = 0; i < CHECKPOINT_MESSAGE_THRESHOLD - 1; i++) await emitIdle("ses-1")
    expect(promptAsync).toHaveBeenCalledTimes(2)
    Date.now = realNow
  })

  test("#given elapsed 15min #when idle occurs #then injects checkpoint by time threshold", async () => {
    await emitIdle("ses-1")
    now += 15 * 60 * 1000 + 1000
    await emitIdle("ses-1")
    expect(promptAsync).toHaveBeenCalledTimes(2)
    Date.now = realNow
  })

  test("#given recent checkpoint #when next idle within cooldown #then does not inject", async () => {
    await emitIdle("ses-1")
    now += 6 * 60 * 1000
    for (let i = 0; i < CHECKPOINT_MESSAGE_THRESHOLD - 1; i++) await emitIdle("ses-1")
    now += 60 * 1000
    await emitIdle("ses-1")
    expect(promptAsync).toHaveBeenCalledTimes(2)
    Date.now = realNow
  })

  test("#given subagent session #when idle event arrives #then skips injection", async () => {
    messages = mock(async () => [{ info: { agent: "explore" } }])
    ctx = { client: { session: { messages, promptAsync } }, directory: "/tmp/test" }
    hook = createAutoCheckpointHook(ctx as never)
    await emitIdle("ses-sub")
    expect(promptAsync).toHaveBeenCalledTimes(0)
    Date.now = realNow
  })

  test("#given deleted session #when idle after deletion #then treats as fresh and restores", async () => {
    await emitIdle("ses-1")
    await emitDeleted("ses-1")
    await emitIdle("ses-1")
    expect(promptAsync).toHaveBeenCalledTimes(2)
    Date.now = realNow
  })

  test("#given non-idle event #when hook handles event #then does nothing", async () => {
    await hook.event({ event: { type: "session.created", properties: { sessionID: "ses-1" } } })
    expect(promptAsync).toHaveBeenCalledTimes(0)
    Date.now = realNow
  })

  test("#given idle event without sessionID #when hook handles event #then does nothing", async () => {
    await hook.event({ event: { type: "session.idle", properties: {} } })
    expect(promptAsync).toHaveBeenCalledTimes(0)
    Date.now = realNow
  })

  test("#given promptAsync failure #when first idle then next idle after cleanup #then logs and retries restore", async () => {
    let shouldFail = true
    promptAsync = mock(async () => {
      if (shouldFail) {
        shouldFail = false
        throw new Error("boom")
      }
    })
    ctx = { client: { session: { messages, promptAsync } }, directory: "/tmp/test" }
    hook = createAutoCheckpointHook(ctx as never)

    await emitIdle("ses-1")
    await emitDeleted("ses-1")
    now += 6 * 60 * 1000
    await emitIdle("ses-1")

    expect(promptAsync).toHaveBeenCalledTimes(2)
    expect(logMock).toHaveBeenCalled()
    Date.now = realNow
  })

  test("#given checkpoint just injected #when 19 idles then 20th idle #then only second threshold injects", async () => {
    await emitIdle("ses-1")
    now += 6 * 60 * 1000
    for (let i = 0; i < CHECKPOINT_MESSAGE_THRESHOLD - 1; i++) await emitIdle("ses-1")

    now += 6 * 60 * 1000
    for (let i = 0; i < CHECKPOINT_MESSAGE_THRESHOLD - 1; i++) await emitIdle("ses-1")
    expect(promptAsync).toHaveBeenCalledTimes(2)

    await emitIdle("ses-1")
    expect(promptAsync).toHaveBeenCalledTimes(3)
    Date.now = realNow
  })
})
