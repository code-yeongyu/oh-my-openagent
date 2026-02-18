const { describe, test, expect, beforeEach } = require("bun:test")
import {
  setPendingSwitch,
  getPendingSwitch,
  clearPendingSwitch,
  consumePendingSwitch,
  _resetForTesting,
} from "./state"

describe("agent-switch state", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  //#given a pending switch is set
  //#when consumePendingSwitch is called
  //#then it returns the switch and removes it
  test("should store and consume a pending switch", () => {
    setPendingSwitch("session-1", "atlas", "Fix these findings")

    const entry = consumePendingSwitch("session-1")

    expect(entry).toEqual({ agent: "atlas", context: "Fix these findings" })
    expect(consumePendingSwitch("session-1")).toBeUndefined()
  })

  //#given no pending switch exists
  //#when consumePendingSwitch is called
  //#then it returns undefined
  test("should return undefined when no switch is pending", () => {
    expect(consumePendingSwitch("session-1")).toBeUndefined()
  })

  //#given a pending switch is set
  //#when a new switch is set for the same session
  //#then the latest switch wins
  test("should overwrite previous switch for same session", () => {
    setPendingSwitch("session-1", "atlas", "Fix A")
    setPendingSwitch("session-1", "prometheus", "Plan B")

    const entry = consumePendingSwitch("session-1")

    expect(entry).toEqual({ agent: "prometheus", context: "Plan B" })
  })

  //#given switches for different sessions
  //#when consumed separately
  //#then each session gets its own switch
  test("should isolate switches by session", () => {
    setPendingSwitch("session-1", "atlas", "Fix A")
    setPendingSwitch("session-2", "prometheus", "Plan B")

    expect(consumePendingSwitch("session-1")).toEqual({ agent: "atlas", context: "Fix A" })
    expect(consumePendingSwitch("session-2")).toEqual({ agent: "prometheus", context: "Plan B" })
  })

  test("should allow reading without consuming", () => {
    setPendingSwitch("session-1", "atlas", "Fix A")

    expect(getPendingSwitch("session-1")).toEqual({ agent: "atlas", context: "Fix A" })
    expect(getPendingSwitch("session-1")).toEqual({ agent: "atlas", context: "Fix A" })
  })

  test("should clear pending switch explicitly", () => {
    setPendingSwitch("session-1", "atlas", "Fix A")

    clearPendingSwitch("session-1")

    expect(getPendingSwitch("session-1")).toBeUndefined()
  })
})

export {}
