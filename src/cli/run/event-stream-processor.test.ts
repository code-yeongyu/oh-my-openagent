import { describe, it, expect } from "bun:test"
import {
  compressEventData,
  compressEventPayload,
  processEvents,
} from "./event-stream-processor"
import type { RunContext, EventPayload, CompressionConfig } from "./types"
import { DEFAULT_COMPRESSION_CONFIG } from "./types"
import { createEventState } from "./event-state"

const createMockContext = (
  sessionID: string = "test-session",
  compression?: CompressionConfig
): RunContext => ({
  client: {} as RunContext["client"],
  sessionID,
  directory: "/test",
  abortController: new AbortController(),
  compression,
})

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item
  }
}

describe("compressEventData", () => {
  describe("#given compression is disabled", () => {
    it("returns JSON stringified data when config.enabled is false", () => {
      // given
      const data = { items: [1, 2, 3, 4, 5] }
      const config: CompressionConfig = { enabled: false, threshold: 5000 }

      // when
      const result = compressEventData(data, config)

      // then
      expect(result).toBe(JSON.stringify(data))
    })
  })

  describe("#given compression is enabled", () => {
    it("returns JSON stringified data when below threshold", () => {
      // given
      const data = { items: [1, 2, 3] }
      const config: CompressionConfig = { enabled: true, threshold: 10000 }

      // when
      const result = compressEventData(data, config)

      // then
      expect(result).toBe(JSON.stringify(data))
    })

    it("returns JSON stringified for session.error payloads", () => {
      // given
      const payload: EventPayload = {
        type: "session.error",
        properties: {
          error: { message: "Something went wrong" },
        },
      }
      const config: CompressionConfig = { enabled: true, threshold: 10 }

      // when
      const result = compressEventData(payload, config)

      // then - error payloads should be JSON stringified, not TOON compressed
      expect(result).toBe(JSON.stringify(payload))
    })

    it("compresses uniform arrays above threshold", () => {
      // given
      const items = Array.from({ length: 10 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
      }))
      const config: CompressionConfig = { enabled: true, threshold: 10 }

      // when
      const result = compressEventData(items, config)

      // then - should return a string (either compressed or JSON)
      expect(typeof result).toBe("string")
      expect(result.length).toBeGreaterThan(0)
    })
  })
})

describe("compressEventPayload", () => {
  describe("#given compression is disabled", () => {
    it("returns JSON stringified payload", () => {
      // given
      const payload: EventPayload = {
        type: "tool.execute",
        properties: {
          name: "read_file",
          input: { path: "/src/index.ts" },
        },
      }
      const config: CompressionConfig = { enabled: false, threshold: 5000 }

      // when
      const result = compressEventPayload(payload, config)

      // then
      expect(result).toBe(JSON.stringify(payload))
    })
  })

  describe("#given compression is enabled", () => {
    it("returns JSON stringified for session.error", () => {
      // given
      const payload: EventPayload = {
        type: "session.error",
        properties: {
          sessionID: "test-session",
          error: { message: "Error occurred" },
        },
      }
      const config: CompressionConfig = { enabled: true, threshold: 10 }

      // when
      const result = compressEventPayload(payload, config)

      // then - error payloads should NOT be compressed
      expect(result).toBe(JSON.stringify(payload))
    })

    it("returns string representation of payload", () => {
      // given
      const payload: EventPayload = {
        type: "tool.execute",
        properties: {
          sessionID: "test-session",
          name: "batch_read",
          files: Array.from({ length: 10 }, (_, i) => ({ id: i })),
        },
      }
      const config: CompressionConfig = { enabled: true, threshold: 10 }

      // when
      const result = compressEventPayload(payload, config)

      // then
      expect(typeof result).toBe("string")
      expect(result.length).toBeGreaterThan(0)
    })
  })
})

describe("processEvents with compression", () => {
  describe("#given compression disabled (default)", () => {
    it("processes events without compression", async () => {
      // given
      const ctx = createMockContext()
      const state = createEventState()

      const payload: EventPayload = {
        type: "session.idle",
        properties: { sessionID: "test-session" },
      }

      const events = toAsyncIterable([payload])

      // when
      await processEvents(ctx, events, state)

      // then
      expect(state.mainSessionIdle).toBe(true)
    })
  })

  describe("#given compression enabled", () => {
    it("processes events with compression config", async () => {
      // given
      const ctx = createMockContext("test-session", {
        enabled: true,
        threshold: 100,
      })
      const state = createEventState()

      const payload: EventPayload = {
        type: "session.idle",
        properties: { sessionID: "test-session" },
      }

      const events = toAsyncIterable([payload])

      // when
      await processEvents(ctx, events, state)

      // then
      expect(state.mainSessionIdle).toBe(true)
    })

    it("handles tool.execute with large input arrays", async () => {
      // given
      const ctx = createMockContext("test-session", {
        enabled: true,
        threshold: 100,
      })
      const state = createEventState()

      const largeArray = Array.from({ length: 10 }, (_, i) => ({
        id: i,
        value: `item-${i}`,
      }))

      const payload: EventPayload = {
        type: "tool.execute",
        properties: {
          sessionID: "test-session",
          name: "batch_read",
          input: { files: largeArray },
        },
      }

      const events = toAsyncIterable([payload])

      // when
      await processEvents(ctx, events, state)

      // then - should process without error
      expect(state.hasReceivedMeaningfulWork).toBe(true)
    })

    it("handles session.error without compression", async () => {
      // given
      const ctx = createMockContext("test-session", {
        enabled: true,
        threshold: 100,
      })
      const state = createEventState()

      const payload: EventPayload = {
        type: "session.error",
        properties: {
          sessionID: "test-session",
          error: { message: "Something went wrong" },
        },
      }

      const events = toAsyncIterable([payload])

      // when
      await processEvents(ctx, events, state)

      // then - error should be handled without compression
      expect(state.mainSessionError).toBe(true)
    })
  })
})
