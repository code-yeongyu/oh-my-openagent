import { describe, it, expect, beforeEach } from "bun:test"
import { ContextCollector } from "./collector"
import type { RegisterContextOptions } from "./types"

describe("ContextCollector Deduplication", () => {
  let collector: ContextCollector
  const sessionID = "test-session"

  beforeEach(() => {
    collector = new ContextCollector()
  })

  it("should not inject 'once' context a second time after consumption", () => {
    const options: RegisterContextOptions = {
      id: "test-id",
      source: "custom",
      content: "test content",
      once: true,
    }

    // First registration
    collector.register(sessionID, options)
    expect(collector.hasPending(sessionID)).toBe(true)

    // First consumption
    const pending1 = collector.consume(sessionID)
    expect(pending1.hasContent).toBe(true)
    expect(pending1.entries[0].content).toBe("test content")

    // Second registration
    collector.register(sessionID, options)
    expect(collector.hasPending(sessionID)).toBe(false)

    // Second consumption
    const pending2 = collector.consume(sessionID)
    expect(pending2.hasContent).toBe(false)
  })

  it("should allow re-injection of normal context", () => {
    const options: RegisterContextOptions = {
      id: "test-id",
      source: "custom",
      content: "test content",
      once: false, // Explicitly false or undefined
    }

    // First registration
    collector.register(sessionID, options)
    
    // First consumption
    const pending1 = collector.consume(sessionID)
    expect(pending1.hasContent).toBe(true)

    // Second registration
    collector.register(sessionID, options)
    expect(collector.hasPending(sessionID)).toBe(true)

    // Second consumption
    const pending2 = collector.consume(sessionID)
    expect(pending2.hasContent).toBe(true)
  })

  it("should dedupe pending 'once' context before consumption (standard behavior)", () => {
    const options: RegisterContextOptions = {
      id: "test-id",
      source: "custom",
      content: "test content",
      once: true,
    }

    collector.register(sessionID, options)
    collector.register(sessionID, { ...options, content: "updated content" })

    const pending = collector.consume(sessionID)
    expect(pending.entries.length).toBe(1)
    expect(pending.entries[0].content).toBe("updated content")
    
    // Try registering again after consume
    collector.register(sessionID, options)
    expect(collector.hasPending(sessionID)).toBe(false)
  })
})
