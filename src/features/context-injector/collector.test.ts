import { describe, it, expect, beforeEach } from "bun:test"
import { ContextCollector } from "./collector"
import type { ContextPriority, ContextSourceType } from "./types"

describe("ContextCollector", () => {
  let collector: ContextCollector

  beforeEach(() => {
    collector = new ContextCollector()
  })

  describe("register", () => {
    it("registers context for a session", () => {
      // #given
      const sessionID = "ses_test1"
      const options = {
        id: "ulw-context",
        source: "keyword-detector" as ContextSourceType,
        content: "Ultrawork mode activated",
      }

      // #when
      collector.register(sessionID, options)

      // #then
      const pending = collector.getPending(sessionID)
      expect(pending.hasContent).toBe(true)
      expect(pending.entries).toHaveLength(1)
      expect(pending.entries[0].content).toBe("Ultrawork mode activated")
    })

    it("assigns default priority of 'normal' when not specified", () => {
      // #given
      const sessionID = "ses_test2"

      // #when
      collector.register(sessionID, {
        id: "test",
        source: "keyword-detector",
        content: "test content",
      })

      // #then
      const pending = collector.getPending(sessionID)
      expect(pending.entries[0].priority).toBe("normal")
    })

    it("uses specified priority", () => {
      // #given
      const sessionID = "ses_test3"

      // #when
      collector.register(sessionID, {
        id: "critical-context",
        source: "keyword-detector",
        content: "critical content",
        priority: "critical",
      })

      // #then
      const pending = collector.getPending(sessionID)
      expect(pending.entries[0].priority).toBe("critical")
    })

    it("deduplicates by source + id combination", () => {
      // #given
      const sessionID = "ses_test4"
      const options = {
        id: "ulw-context",
        source: "keyword-detector" as ContextSourceType,
        content: "First content",
      }

      // #when
      collector.register(sessionID, options)
      collector.register(sessionID, { ...options, content: "Updated content" })

      // #then
      const pending = collector.getPending(sessionID)
      expect(pending.entries).toHaveLength(1)
      expect(pending.entries[0].content).toBe("Updated content")
    })

    it("allows same id from different sources", () => {
      // #given
      const sessionID = "ses_test5"

      // #when
      collector.register(sessionID, {
        id: "context-1",
        source: "keyword-detector",
        content: "From keyword-detector",
      })
      collector.register(sessionID, {
        id: "context-1",
        source: "rules-injector",
        content: "From rules-injector",
      })

      // #then
      const pending = collector.getPending(sessionID)
      expect(pending.entries).toHaveLength(2)
    })
  })

  describe("getPending", () => {
    it("returns empty result for session with no context", () => {
      // #given
      const sessionID = "ses_empty"

      // #when
      const pending = collector.getPending(sessionID)

      // #then
      expect(pending.hasContent).toBe(false)
      expect(pending.entries).toHaveLength(0)
      expect(pending.merged).toBe("")
    })

    it("merges multiple contexts with separator", () => {
      // #given
      const sessionID = "ses_merge"
      collector.register(sessionID, {
        id: "ctx-1",
        source: "keyword-detector",
        content: "First context",
      })
      collector.register(sessionID, {
        id: "ctx-2",
        source: "rules-injector",
        content: "Second context",
      })

      // #when
      const pending = collector.getPending(sessionID)

      // #then
      expect(pending.hasContent).toBe(true)
      expect(pending.merged).toContain("First context")
      expect(pending.merged).toContain("Second context")
    })

    it("orders contexts by priority (critical > high > normal > low)", () => {
      // #given
      const sessionID = "ses_priority"
      collector.register(sessionID, {
        id: "low",
        source: "custom",
        content: "LOW",
        priority: "low",
      })
      collector.register(sessionID, {
        id: "critical",
        source: "custom",
        content: "CRITICAL",
        priority: "critical",
      })
      collector.register(sessionID, {
        id: "normal",
        source: "custom",
        content: "NORMAL",
        priority: "normal",
      })
      collector.register(sessionID, {
        id: "high",
        source: "custom",
        content: "HIGH",
        priority: "high",
      })

      // #when
      const pending = collector.getPending(sessionID)

      // #then
      const order = pending.entries.map((e) => e.priority)
      expect(order).toEqual(["critical", "high", "normal", "low"])
    })

    it("maintains registration order within same priority", () => {
      // #given
      const sessionID = "ses_order"
      collector.register(sessionID, {
        id: "first",
        source: "custom",
        content: "First",
        priority: "normal",
      })
      collector.register(sessionID, {
        id: "second",
        source: "custom",
        content: "Second",
        priority: "normal",
      })
      collector.register(sessionID, {
        id: "third",
        source: "custom",
        content: "Third",
        priority: "normal",
      })

      // #when
      const pending = collector.getPending(sessionID)

      // #then
      const ids = pending.entries.map((e) => e.id)
      expect(ids).toEqual(["first", "second", "third"])
    })
  })

  describe("consume", () => {
    it("clears pending context for session", () => {
      // #given
      const sessionID = "ses_consume"
      collector.register(sessionID, {
        id: "ctx",
        source: "keyword-detector",
        content: "test",
      })

      // #when
      collector.consume(sessionID)

      // #then
      const pending = collector.getPending(sessionID)
      expect(pending.hasContent).toBe(false)
    })

    it("returns the consumed context", () => {
      // #given
      const sessionID = "ses_consume_return"
      collector.register(sessionID, {
        id: "ctx",
        source: "keyword-detector",
        content: "test content",
      })

      // #when
      const consumed = collector.consume(sessionID)

      // #then
      expect(consumed.hasContent).toBe(true)
      expect(consumed.entries[0].content).toBe("test content")
    })

    it("does not affect other sessions", () => {
      // #given
      const session1 = "ses_1"
      const session2 = "ses_2"
      collector.register(session1, {
        id: "ctx",
        source: "keyword-detector",
        content: "session 1",
      })
      collector.register(session2, {
        id: "ctx",
        source: "keyword-detector",
        content: "session 2",
      })

      // #when
      collector.consume(session1)

      // #then
      expect(collector.getPending(session1).hasContent).toBe(false)
      expect(collector.getPending(session2).hasContent).toBe(true)
    })
  })

  describe("clear", () => {
    it("removes all context for a session", () => {
      // #given
      const sessionID = "ses_clear"
      collector.register(sessionID, {
        id: "ctx-1",
        source: "keyword-detector",
        content: "test 1",
      })
      collector.register(sessionID, {
        id: "ctx-2",
        source: "rules-injector",
        content: "test 2",
      })

      // #when
      collector.clear(sessionID)

      // #then
      expect(collector.getPending(sessionID).hasContent).toBe(false)
    })
  })

  describe("hasPending", () => {
    it("returns true when session has pending context", () => {
      // #given
      const sessionID = "ses_has"
      collector.register(sessionID, {
        id: "ctx",
        source: "keyword-detector",
        content: "test",
      })

      // #when / #then
      expect(collector.hasPending(sessionID)).toBe(true)
    })

    it("returns false when session has no pending context", () => {
      // #given
      const sessionID = "ses_empty"

      // #when / #then
      expect(collector.hasPending(sessionID)).toBe(false)
    })

    it("returns false after consume", () => {
      // #given
      const sessionID = "ses_after_consume"
      collector.register(sessionID, {
        id: "ctx",
        source: "keyword-detector",
        content: "test",
      })

      // #when
      collector.consume(sessionID)

      // #then
      expect(collector.hasPending(sessionID)).toBe(false)
    })
  })
})
