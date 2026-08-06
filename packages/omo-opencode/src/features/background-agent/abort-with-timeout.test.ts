import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

const logMock = mock((..._args: unknown[]) => {})

mock.module("../../shared/logger", () => ({
  log: logMock,
}))

import type { OpencodeClient } from "./opencode-client"

const { abortWithTimeout } = await import("./abort-with-timeout")
mock.restore()

function createClient(abort: (...args: Array<unknown>) => Promise<unknown>): OpencodeClient {
  return {
    session: {
      abort: abort as never,
    },
  } as never
}

function hasSessionID(value: unknown, sessionID: string): boolean {
  return typeof value === "object" && value !== null && "sessionID" in value && value.sessionID === sessionID
}

function logCallsForSession(sessionID: string): unknown[][] {
  return logMock.mock.calls.filter((call) => hasSessionID(call[1], sessionID))
}

describe("abortWithTimeout", () => {
  beforeEach(() => {
    logMock.mockClear()
  })

  afterAll(() => {
    mock.restore()
  })

  test("#given abort resolves before timeout #when abortWithTimeout runs #then it returns true", async () => {
    // given
    const abort = mock(async () => ({}))

    // when
    const result = await abortWithTimeout(createClient(abort), "session-1", 10)

    // then
    expect(result).toBe(true)
    expect(abort).toHaveBeenCalledWith({ path: { id: "session-1" } })
    expect(logCallsForSession("session-1")).toHaveLength(0)
  })

  test("#given abort resolves with an SDK error response #when abortWithTimeout runs #then it reports cancellation failure", async () => {
    // given
    const error = { message: "session not found" }
    const abort = mock(async () => ({ error }))

    // when
    const result = await abortWithTimeout(createClient(abort), "session-error-response", 10)

    // then
    expect(result).toBe(false)
    expect(logMock).toHaveBeenCalledWith(
      "[background-agent] Session abort returned an error response:",
      { sessionID: "session-error-response", error },
    )
  })

  test("#given abort hangs indefinitely #when abortWithTimeout runs #then it logs warning and continues", async () => {
    // given
    const abort = mock(() => new Promise<never>(() => {}))

    // when
    const result = await Promise.race([
      abortWithTimeout(createClient(abort), "session-2", 1),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("abort timeout test exceeded wait budget")), 100)
      }),
    ])

    // then
    expect(result).toBe(false)
    expect(logMock).toHaveBeenCalledWith(
      "[background-agent] Session abort timed out; continuing cleanup:",
      { sessionID: "session-2", timeoutMs: 1 },
    )
  })
})
