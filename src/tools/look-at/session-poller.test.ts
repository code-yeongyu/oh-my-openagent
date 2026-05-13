import { describe, expect, test, mock } from "bun:test"
import { pollSessionUntilIdle } from "./session-poller"

type SessionStatusResult = {
  data?: Record<string, { type: string; attempt?: number; message?: string; next?: number }>
  error?: unknown
}

function createMockClient(statusSequence: SessionStatusResult[]) {
  let callIndex = 0
  return {
    session: {
      status: mock(async () => {
        const result = statusSequence[callIndex] ?? statusSequence[statusSequence.length - 1]
        callIndex++
        return result
      }),
    },
  }
}

describe("pollSessionUntilIdle", () => {
  // given session transitions from busy to idle
  // when polling for completion
  // then resolves successfully
  test("resolves when session becomes idle", async () => {
    const client = createMockClient([
      { data: { ses_test: { type: "busy" } } },
      { data: { ses_test: { type: "busy" } } },
      { data: { ses_test: { type: "idle" } } },
    ])

    await pollSessionUntilIdle(client as any, "ses_test", { pollIntervalMs: 10, timeoutMs: 5000 })

    expect(client.session.status).toHaveBeenCalledTimes(3)
  })

  // given session is already idle (not in status map)
  // when polling for completion
  // then resolves immediately
  test("resolves when session not found in status (idle by default)", async () => {
    const client = createMockClient([
      { data: {} },
    ])

    await pollSessionUntilIdle(client as any, "ses_test", { pollIntervalMs: 10, timeoutMs: 5000 })

    expect(client.session.status).toHaveBeenCalledTimes(1)
  })

  // given session never becomes idle
  // when polling exceeds timeout
  // then rejects with timeout error
  test("rejects with timeout when session stays busy", async () => {
    const client = createMockClient([
      { data: { ses_test: { type: "busy" } } },
    ])

    await expect(
      pollSessionUntilIdle(client as any, "ses_test", { pollIntervalMs: 10, timeoutMs: 50 })
    ).rejects.toThrow("timed out")
  })

  // given session status API returns error
  // when polling for completion
  // then treats as idle (graceful degradation)
  test("resolves on status API error (graceful degradation)", async () => {
    const client = createMockClient([
      { error: new Error("API error") },
    ])

    await pollSessionUntilIdle(client as any, "ses_test", { pollIntervalMs: 10, timeoutMs: 5000 })

    expect(client.session.status).toHaveBeenCalledTimes(1)
  })

  // given session is in retry state
  // when polling for completion
  // then keeps polling until idle
  test("keeps polling through retry state", async () => {
    const client = createMockClient([
      { data: { ses_test: { type: "busy" } } },
      { data: { ses_test: { type: "retry", attempt: 1, message: "retrying", next: 1000 } } },
      { data: { ses_test: { type: "busy" } } },
      { data: {} },
    ])

    await pollSessionUntilIdle(client as any, "ses_test", { pollIntervalMs: 10, timeoutMs: 5000 })

    expect(client.session.status).toHaveBeenCalledTimes(4)
  })

  // given default options
  // when polling
  // then uses sensible defaults
  test("uses default options when none provided", async () => {
    const client = createMockClient([
      { data: {} },
    ])

    await pollSessionUntilIdle(client as any, "ses_test")

    expect(client.session.status).toHaveBeenCalledTimes(1)
  })
})
