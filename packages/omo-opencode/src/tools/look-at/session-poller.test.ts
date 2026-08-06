import { describe, expect, test, mock } from "bun:test"
import { waitForLookAtSessionResult } from "./session-poller"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

type SessionStatusResult = {
  data?: Record<string, { type: string; attempt?: number; message?: string; next?: number }>
  error?: unknown
}

type RawMessage = {
  info: { role: string; time?: { created?: number } }
  parts: Array<{ type: string; text?: string }>
}

function createMockClient(
  statusSequence: SessionStatusResult[],
  messages: RawMessage[] = [],
  options: { gateMessagesOnIdle?: boolean } = {},
) {
  let statusCallIndex = 0
  let hasSeenIdle = false
  const gateMessagesOnIdle = options.gateMessagesOnIdle ?? true
  return {
    session: {
      status: mock(async () => {
        const result = statusSequence[statusCallIndex] ?? statusSequence[statusSequence.length - 1]
        statusCallIndex++
        const sessionEntry = Object.values(result.data ?? {})[0]
        if (!sessionEntry || sessionEntry.type === "idle") {
          hasSeenIdle = true
        }
        return result
      }),
      messages: mock(async () => ({
        data: gateMessagesOnIdle && !hasSeenIdle ? [] : messages,
        error: null,
      })),
    },
  }
}

describe("waitForLookAtSessionResult", () => {
  test("#given session transitions to idle with assistant response #when polling #then resolves with messages", async () => {
    const assistantMessages: RawMessage[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "analyze this" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "result text" }] },
    ]
    const client = createMockClient(
      [
        { data: { ses_test: { type: "busy" } } },
        { data: { ses_test: { type: "busy" } } },
        { data: {} },
      ],
      assistantMessages,
    )

    const result = await waitForLookAtSessionResult(unsafeTestValue(client), "ses_test", {
      pollIntervalMs: 10,
      timeoutMs: 5000,
    })

    expect(result.messages).toHaveLength(2)
    expect(result.outcome.text).toBe("result text")
  })

  test("#given session is already idle with content #when polling #then resolves with stable idle", async () => {
    const messages: RawMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "done" }] },
    ]
    const client = createMockClient([{ data: {} }], messages)

    const result = await waitForLookAtSessionResult(unsafeTestValue(client), "ses_test", {
      pollIntervalMs: 10,
      timeoutMs: 5000,
      allowStableIdleWithoutActivity: true,
    })

    expect(result.outcome.text).toBe("done")
  })

  test("#given session is absent and has no assistant output #when stable idle is allowed #then keeps polling", async () => {
    const client = createMockClient([{ data: {} }], [])

    await expect(
      waitForLookAtSessionResult(unsafeTestValue(client), "ses_test", {
        pollIntervalMs: 10,
        timeoutMs: 50,
        allowStableIdleWithoutActivity: true,
      }),
    ).rejects.toThrow("timed out")
  })

  test("#given supported status never lists the session but assistant output exists #when polling #then resolves with observed output", async () => {
    const assistantMessages: RawMessage[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "inspect this" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "observed result" }] },
    ]
    const client = createMockClient([{ data: {} }], assistantMessages)

    const result = await waitForLookAtSessionResult(unsafeTestValue(client), "ses_test", {
      pollIntervalMs: 10,
      timeoutMs: 5000,
    })

    expect(result.outcome.text).toBe("observed result")
    expect(client.session.status).toHaveBeenCalledTimes(1)
  })

  test("#given status omits session before it starts #when later idle has response #then waits instead of treating empty status as done", async () => {
    const assistantMessages: RawMessage[] = [
      { info: { role: "user" }, parts: [{ type: "text", text: "analyze this" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "late result" }] },
    ]
    let statusCalls = 0
    const client = {
      session: {
        status: mock(async () => {
          statusCalls += 1
          if (statusCalls <= 3) return { data: {} }
          if (statusCalls === 4) return { data: { ses_test: { type: "busy" } } }
          return { data: { ses_test: { type: "idle" } } }
        }),
        messages: mock(async () => ({
          data: statusCalls >= 5 ? assistantMessages : [],
          error: null,
        })),
      },
    }

    const result = await waitForLookAtSessionResult(unsafeTestValue(client), "ses_test", {
      pollIntervalMs: 10,
      timeoutMs: 5000,
    })

    expect(result.outcome.text).toBe("late result")
    expect(statusCalls).toBe(5)
  })

  test("#given session never becomes idle #when polling exceeds timeout #then rejects", async () => {
    const client = createMockClient(
      [{ data: { ses_test: { type: "busy" } } }],
      [],
    )

    await expect(
      waitForLookAtSessionResult(unsafeTestValue(client), "ses_test", {
        pollIntervalMs: 10,
        timeoutMs: 50,
      }),
    ).rejects.toThrow("timed out")
  })

  test("#given session status API returns error #when polling #then treats as idle (graceful degradation)", async () => {
    const messages: RawMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] },
    ]
    const client = createMockClient([{ error: new Error("API error") }], messages)

    const result = await waitForLookAtSessionResult(unsafeTestValue(client), "ses_test", {
      pollIntervalMs: 10,
      timeoutMs: 5000,
      allowStableIdleWithoutActivity: true,
    })

    expect(result.outcome.text).toBe("ok")
  })

  test("#given default options #when polling #then uses sensible defaults", async () => {
    const messages: RawMessage[] = [
      { info: { role: "assistant" }, parts: [{ type: "text", text: "hi" }] },
    ]
    const client = createMockClient([{ data: {} }], messages)

    const result = await waitForLookAtSessionResult(unsafeTestValue(client), "ses_test", {
      pollIntervalMs: 10,
      timeoutMs: 5000,
      allowStableIdleWithoutActivity: true,
    })

    expect(client.session.status).toHaveBeenCalled()
    expect(result.messages).toBeDefined()
  })
})
