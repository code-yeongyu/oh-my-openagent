const { describe, expect, it } = require("bun:test")

import { AsyncHandlerTimeoutError, Mem0AsyncEventHandler } from "./async-handler"

describe("Mem0AsyncEventHandler", () => {
  it("#given best-effort write #when no memory id needed #then returns event id immediately", async () => {
    let calls = 0
    const handler = new Mem0AsyncEventHandler(
      {
        getEvent: async () => {
          calls++
          return { event_id: "evt_1", status: "PENDING" }
        },
      },
      { skipPollForBestEffort: true },
    )

    const result = await handler.waitForCompletion("evt_1", false)

    expect(result).toBe("evt_1")
    expect(calls).toBe(0)
  })

  it("#given memory id required #when event completes #then polls until done and returns memory id", async () => {
    const statuses = [
      { event_id: "evt_2", status: "PENDING" as const },
      { event_id: "evt_2", status: "DONE" as const, memory_id: "mem0_123" },
    ]
    const handler = new Mem0AsyncEventHandler(
      {
        getEvent: async () => statuses.shift() ?? { event_id: "evt_2", status: "DONE", memory_id: "mem0_123" },
      },
      { pollIntervalMs: 0, maxPollAttempts: 3, skipPollForBestEffort: false },
    )

    const result = await handler.waitForCompletion("evt_2", true)

    expect(result).toBe("mem0_123")
  })

  it("#given pending event #when max attempts exhausted #then throws timeout error", async () => {
    const handler = new Mem0AsyncEventHandler(
      {
        getEvent: async () => ({ event_id: "evt_3", status: "PENDING" }),
      },
      { pollIntervalMs: 0, maxPollAttempts: 2, skipPollForBestEffort: false },
    )

    await expect(handler.waitForCompletion("evt_3", true)).rejects.toBeInstanceOf(AsyncHandlerTimeoutError)
  })

  it("#given failed event #when polled #then throws failure error", async () => {
    const handler = new Mem0AsyncEventHandler(
      {
        getEvent: async () => ({ event_id: "evt_4", status: "FAILED", error: "boom" }),
      },
      { pollIntervalMs: 0, maxPollAttempts: 1, skipPollForBestEffort: false },
    )

    await expect(handler.waitForCompletion("evt_4", true)).rejects.toThrow("Async Mem0 event evt_4 failed: boom")
  })
})
