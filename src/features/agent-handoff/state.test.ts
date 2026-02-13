import { describe, test, expect, beforeEach } from "bun:test"
import { setPendingHandoff, consumePendingHandoff, _resetForTesting } from "./state"

describe("agent-handoff state", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  //#given a pending handoff is set
  //#when consumePendingHandoff is called
  //#then it returns the handoff and removes it
  test("should store and consume a pending handoff", () => {
    setPendingHandoff("session-1", "atlas", "Fix these findings")

    const handoff = consumePendingHandoff("session-1")

    expect(handoff).toEqual({ agent: "atlas", context: "Fix these findings" })
    expect(consumePendingHandoff("session-1")).toBeUndefined()
  })

  //#given no pending handoff exists
  //#when consumePendingHandoff is called
  //#then it returns undefined
  test("should return undefined when no handoff is pending", () => {
    expect(consumePendingHandoff("session-1")).toBeUndefined()
  })

  //#given a pending handoff is set
  //#when a new handoff is set for the same session
  //#then the latest handoff wins
  test("should overwrite previous handoff for same session", () => {
    setPendingHandoff("session-1", "atlas", "Fix A")
    setPendingHandoff("session-1", "prometheus", "Plan B")

    const handoff = consumePendingHandoff("session-1")

    expect(handoff).toEqual({ agent: "prometheus", context: "Plan B" })
  })

  //#given handoffs for different sessions
  //#when consumed separately
  //#then each session gets its own handoff
  test("should isolate handoffs by session", () => {
    setPendingHandoff("session-1", "atlas", "Fix A")
    setPendingHandoff("session-2", "prometheus", "Plan B")

    expect(consumePendingHandoff("session-1")).toEqual({ agent: "atlas", context: "Fix A" })
    expect(consumePendingHandoff("session-2")).toEqual({ agent: "prometheus", context: "Plan B" })
  })
})
