import { describe, expect, test, mock } from "bun:test"
import { waitForLookAtSessionResult } from "./session-poller"

type StatusMap = Record<string, { type: string }>

function createMockClient(args?: {
  statusSequence?: Array<StatusMap>
  messageSequence?: Array<unknown[]>
  includeStatus?: boolean
}) {
  let statusIndex = 0
  let messageIndex = 0
  const statusSequence = args?.statusSequence ?? [{ ses_test: { type: "idle" } }]
  const messageSequence = args?.messageSequence ?? [[]]

  return {
    session: {
      status: args?.includeStatus === false
        ? undefined
        : mock(async () => {
            const result = statusSequence[statusIndex] ?? statusSequence[statusSequence.length - 1]
            statusIndex += 1
            return { data: result }
          }),
      messages: mock(async () => {
        const result = messageSequence[messageIndex] ?? messageSequence[messageSequence.length - 1]
        messageIndex += 1
        return { data: result }
      }),
      abort: mock(async () => ({ data: {} })),
    },
  }
}

describe("waitForLookAtSessionResult", () => {
  test("returns assistant text once child session completes", async () => {
    const client = createMockClient({
      statusSequence: [
        { ses_test: { type: "running" } },
        { ses_test: { type: "idle" } },
      ],
      messageSequence: [
        [],
        [
          {
            info: { role: "assistant", time: { created: 1, completed: 2 } },
            parts: [{ type: "text", text: "done" }],
          },
        ],
      ],
    })

    const result = await waitForLookAtSessionResult(client as any, "ses_test", {
      pollIntervalMs: 1,
      timeoutMs: 100,
    })

    expect(result.outcome.text).toBe("done")
    expect(result.statusType).toBe("idle")
  })

  test("returns assistant error outcome when child session ends with error", async () => {
    const client = createMockClient({
      statusSequence: [{ ses_test: { type: "idle" } }],
      messageSequence: [
        [
          {
            role: "assistant",
            time: { created: 1, completed: 2 },
            error: { name: "MessageAbortedError", data: { message: "The operation was aborted." } },
          },
        ],
      ],
    })

    const result = await waitForLookAtSessionResult(client as any, "ses_test", {
      pollIntervalMs: 1,
      timeoutMs: 100,
      allowStableIdleWithoutActivity: true,
    })

    expect(result.outcome.text).toBeNull()
    expect(result.outcome.errorName).toBe("MessageAbortedError")
  })

  test("returns empty outcome after stable idle once activity has stopped", async () => {
    const client = createMockClient({
      statusSequence: [
        { ses_test: { type: "running" } },
        { ses_test: { type: "idle" } },
        { ses_test: { type: "idle" } },
        { ses_test: { type: "idle" } },
      ],
      messageSequence: [[], [], [], []],
    })

    const result = await waitForLookAtSessionResult(client as any, "ses_test", {
      pollIntervalMs: 1,
      timeoutMs: 100,
    })

    expect(result.outcome.text).toBeNull()
    expect(client.session.messages).toHaveBeenCalledTimes(4)
  })

  test("falls back to message stability when status API is unavailable", async () => {
    const client = createMockClient({
      includeStatus: false,
      messageSequence: [[], [], []],
    })

    const result = await waitForLookAtSessionResult(client as any, "ses_test", {
      pollIntervalMs: 1,
      timeoutMs: 100,
    })

    expect(result.outcome.text).toBeNull()
    expect(client.session.messages).toHaveBeenCalledTimes(3)
  })

  test("aborts child session when upstream abort signal is triggered", async () => {
    const controller = new AbortController()
    const client = createMockClient({
      statusSequence: [{ ses_test: { type: "running" } }],
      messageSequence: [[]],
    })

    const waitPromise = waitForLookAtSessionResult(client as any, "ses_test", {
      pollIntervalMs: 1,
      timeoutMs: 100,
      abortSignal: controller.signal,
    })

    controller.abort(new Error("cancelled"))

    await expect(waitPromise).rejects.toThrow("aborted")
    expect(client.session.abort).toHaveBeenCalledWith({ path: { id: "ses_test" } })
  })
})
