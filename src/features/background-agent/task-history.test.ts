import { describe, expect, it } from "bun:test"
import { TaskHistory } from "./task-history"

describe("TaskHistory", () => {
  describe("record", () => {
    it("stores an entry for a parent session", () => {
      //#given
      const history = new TaskHistory()

      //#when
      history.record("parent-1", { id: "t1", agent: "explore", description: "Find auth", status: "pending" })

      //#then
      const entries = history.getByParentSession("parent-1")
      expect(entries).toHaveLength(1)
      expect(entries[0].id).toBe("t1")
      expect(entries[0].agent).toBe("explore")
      expect(entries[0].status).toBe("pending")
    })

    it("ignores undefined parentSessionID", () => {
      //#given
      const history = new TaskHistory()

      //#when
      history.record(undefined, { id: "t1", agent: "explore", description: "Find auth", status: "pending" })

      //#then
      expect(history.getByParentSession("undefined")).toHaveLength(0)
    })

    it("upserts without clobbering undefined fields", () => {
      //#given
      const history = new TaskHistory()
      history.record("parent-1", { id: "t1", agent: "explore", description: "Find auth", status: "pending", category: "quick" })

      //#when
      history.record("parent-1", { id: "t1", agent: "explore", description: "Find auth", status: "running" })

      //#then
      const entries = history.getByParentSession("parent-1")
      expect(entries).toHaveLength(1)
      expect(entries[0].status).toBe("running")
      expect(entries[0].category).toBe("quick")
    })

    it("caps entries at MAX_ENTRIES_PER_PARENT (100)", () => {
      //#given
      const history = new TaskHistory()

      //#when
      for (let i = 0; i < 105; i++) {
        history.record("parent-1", { id: `t${i}`, agent: "explore", description: `Task ${i}`, status: "completed" })
      }

      //#then
      const entries = history.getByParentSession("parent-1")
      expect(entries).toHaveLength(100)
      expect(entries[0].id).toBe("t5")
      expect(entries[99].id).toBe("t104")
    })
  })

  describe("getByParentSession", () => {
    it("returns defensive copies", () => {
      //#given
      const history = new TaskHistory()
      history.record("parent-1", { id: "t1", agent: "explore", description: "Find auth", status: "pending" })

      //#when
      const entries = history.getByParentSession("parent-1")
      entries[0].status = "completed"

      //#then
      const fresh = history.getByParentSession("parent-1")
      expect(fresh[0].status).toBe("pending")
    })

    it("returns empty array for unknown parent", () => {
      //#given
      const history = new TaskHistory()

      //#when
      const entries = history.getByParentSession("nonexistent")

      //#then
      expect(entries).toHaveLength(0)
    })
  })

  describe("clearSession", () => {
    it("removes all entries for a parent session", () => {
      //#given
      const history = new TaskHistory()
      history.record("parent-1", { id: "t1", agent: "explore", description: "Find auth", status: "pending" })
      history.record("parent-2", { id: "t2", agent: "oracle", description: "Review", status: "running" })

      //#when
      history.clearSession("parent-1")

      //#then
      expect(history.getByParentSession("parent-1")).toHaveLength(0)
      expect(history.getByParentSession("parent-2")).toHaveLength(1)
    })
  })

  describe("formatForCompaction", () => {
    it("returns null when no entries exist", () => {
      //#given
      const history = new TaskHistory()

      //#when
      const result = history.formatForCompaction("nonexistent")

      //#then
      expect(result).toBeNull()
    })

    it("formats entries with agent, status, and description", () => {
      //#given
      const history = new TaskHistory()
      history.record("parent-1", { id: "t1", agent: "explore", description: "Find auth patterns", status: "completed" })

      //#when
      const result = history.formatForCompaction("parent-1")

      //#then
      expect(result).toContain("**explore**")
      expect(result).toContain("(completed)")
      expect(result).toContain("Find auth patterns")
    })

    it("includes category when present", () => {
      //#given
      const history = new TaskHistory()
      history.record("parent-1", { id: "t1", agent: "explore", description: "Find auth", status: "running", category: "quick" })

      //#when
      const result = history.formatForCompaction("parent-1")

      //#then
      expect(result).toContain("[quick]")
    })

    it("includes session_id when present", () => {
      //#given
      const history = new TaskHistory()
      history.record("parent-1", { id: "t1", sessionID: "ses_abc123", agent: "oracle", description: "Review arch", status: "completed" })

      //#when
      const result = history.formatForCompaction("parent-1")

      //#then
      expect(result).toContain("`ses_abc123`")
    })

    it("sanitizes newlines in description", () => {
      //#given
      const history = new TaskHistory()
      history.record("parent-1", { id: "t1", agent: "explore", description: "Line1\nLine2\rLine3", status: "pending" })

      //#when
      const result = history.formatForCompaction("parent-1")

      //#then
      expect(result).not.toContain("\n\n")
      expect(result).toContain("Line1 Line2 Line3")
    })
  })
})
