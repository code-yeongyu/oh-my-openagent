import { afterAll, describe, expect, mock, test } from "bun:test"

const logMock = mock(() => {})

mock.module("../../shared", () => ({
  log: logMock,
}))

import { abortWithTimeout } from "./abort-with-timeout"
import type { OpencodeClient } from "./opencode-client"

function createClient(abort: (...args: Array<unknown>) => Promise<unknown>): OpencodeClient {
  return {
    session: {
      abort: abort as never,
    },
  } as never
}

describe("abortWithTimeout", () => {
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
    expect(logMock).not.toHaveBeenCalled()
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
