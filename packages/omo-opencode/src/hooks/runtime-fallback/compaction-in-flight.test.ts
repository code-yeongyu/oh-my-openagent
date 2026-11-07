import { afterEach, describe, expect, test } from "bun:test"
import {
  getCompaction,
  isCompactionInFlight,
  observeCompactionEvent,
  clearAllCompactions,
  recordCompactionEnd,
  recordCompactionStart,
} from "../../shared/compaction-in-flight"
import {
  installRuntimeFallbackTestClock,
  restoreRuntimeFallbackTestClock,
} from "./test-timeout-clock.test-support"

describe("compaction-in-flight registry", () => {
  afterEach(() => {
    clearAllCompactions()
    restoreRuntimeFallbackTestClock()
  })

  test("tracks a compaction until its completion event", () => {
    installRuntimeFallbackTestClock(1000)
    recordCompactionStart("session")
    expect(isCompactionInFlight("session")).toBe(true)
    observeCompactionEvent({ type: "session.compacted", properties: { sessionID: "session" } })
    expect(isCompactionInFlight("session")).toBe(false)
    expect(getCompaction("session")?.endedAt).toBe(1000)
  })

  test("does not clear a compaction on session.idle", () => {
    installRuntimeFallbackTestClock(1000)
    recordCompactionStart("session")
    observeCompactionEvent({ type: "session.idle", properties: { sessionID: "session" } })
    expect(isCompactionInFlight("session")).toBe(true)
  })

  test("recognizes an in-progress compaction assistant message", () => {
    installRuntimeFallbackTestClock(1000)
    observeCompactionEvent({
      type: "message.updated",
      properties: { info: { sessionID: "session", id: "message", role: "assistant", agent: "compaction" } },
    })
    expect(getCompaction("session")?.messageID).toBe("message")
  })

  test("expires an abandoned compaction after the registry TTL", () => {
    installRuntimeFallbackTestClock(1000)
    recordCompactionStart("session")
    installRuntimeFallbackTestClock(901_001)
    expect(getCompaction("session")).toBeUndefined()
  })

  test("keeps the plugin-start generation when a message start follows it", () => {
    installRuntimeFallbackTestClock(1000)
    recordCompactionStart("session")
    const pluginGeneration = getCompaction("session")
    installRuntimeFallbackTestClock(2000)

    observeCompactionEvent({
      type: "message.updated",
      properties: { info: { sessionID: "session", id: "message", role: "assistant", agent: "compaction" } },
    })

    expect(getCompaction("session")).toMatchObject({
      gen: pluginGeneration?.gen,
      startedAt: 1000,
      messageID: "message",
    })
  })

  test("ignores a stale message end from an older generation", () => {
    installRuntimeFallbackTestClock(1000)
    observeCompactionEvent({
      type: "message.updated",
      properties: { info: { sessionID: "session", id: "first", role: "assistant", agent: "compaction" } },
    })
    installRuntimeFallbackTestClock(2000)
    recordCompactionStart("session")
    observeCompactionEvent({
      type: "message.updated",
      properties: { info: { sessionID: "session", id: "second", role: "assistant", agent: "compaction" } },
    })
    observeCompactionEvent({
      type: "message.updated",
      properties: { info: { sessionID: "session", id: "first", role: "assistant", time: { completed: 3000 } } },
    })

    expect(isCompactionInFlight("session")).toBe(true)
    expect(getCompaction("session")?.messageID).toBe("second")
  })

  test("ignores a stale session end when it identifies an older generation", () => {
    installRuntimeFallbackTestClock(1000)
    recordCompactionStart("session")
    const firstGeneration = getCompaction("session")?.gen
    installRuntimeFallbackTestClock(2000)
    recordCompactionStart("session")
    const secondGeneration = getCompaction("session")?.gen

    observeCompactionEvent({
      type: "session.compaction.ended",
      properties: { sessionID: "session", generation: firstGeneration },
    })

    expect(getCompaction("session")).toMatchObject({ gen: secondGeneration, startedAt: 2000 })
    expect(isCompactionInFlight("session")).toBe(true)
  })

  test("ignores an end event received before the first start", () => {
    installRuntimeFallbackTestClock(1000)
    recordCompactionEnd("session")
    expect(getCompaction("session")).toBeUndefined()

    recordCompactionStart("session")
    expect(isCompactionInFlight("session")).toBe(true)
  })

  test("ignores a late non-completed update for the ended compaction message", () => {
    installRuntimeFallbackTestClock(1000)
    observeCompactionEvent({
      type: "message.updated",
      properties: { info: { sessionID: "session", id: "message", role: "assistant", agent: "compaction" } },
    })
    recordCompactionEnd("session", undefined, "message")
    installRuntimeFallbackTestClock(2000)

    observeCompactionEvent({
      type: "message.updated",
      properties: { info: { sessionID: "session", id: "message", role: "assistant", agent: "compaction" } },
    })

    expect(getCompaction("session")).toMatchObject({ endedAt: 1000, messageID: "message" })
    expect(isCompactionInFlight("session")).toBe(false)
  })
})
