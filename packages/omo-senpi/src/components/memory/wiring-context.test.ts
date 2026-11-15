import { describe, expect, it } from "bun:test"
import { branchEntryCount, readStatusUi } from "./wiring-context"
import type { MemorySessionStateLike } from "./wiring-types"

describe("branchEntryCount", () => {
  it("#given a session manager exposing getEntryCount #when the count is read #then entries are never materialized", () => {
    const eventCtx = {
      sessionManager: {
        getEntryCount: () => 7,
        getEntries: () => {
          throw new Error("getEntries must not be called when getEntryCount exists")
        },
      },
    }

    expect(branchEntryCount(eventCtx)).toBe(7)
  })

  it("#given a session manager without getEntryCount #when the count is read #then it falls back to getEntries().length", () => {
    const eventCtx = { sessionManager: { getEntries: () => [1, 2, 3] } }

    expect(branchEntryCount(eventCtx)).toBe(3)
  })

  it("#given no session manager #when the count is read #then it is zero", () => {
    expect(branchEntryCount({})).toBe(0)
    expect(branchEntryCount(undefined)).toBe(0)
  })
})

describe("readStatusUi", () => {
  it("#given a session marked shutting down #when a status and a notice are sent #then the status is dropped and the notice is delivered", () => {
    // given
    const calls: unknown[] = []
    const eventCtx = {
      sessionManager: { getSessionId: () => "session-closing" },
      ui: {
        setStatus: (key: string, text?: string) => calls.push(["status", key, text]),
        notify: (message: string, level: string) => calls.push(["notify", message, level]),
      },
    }
    const state: MemorySessionStateLike = {}
    const ui = readStatusUi(eventCtx, new Map([["session-closing", state]]))
    ui?.setStatus("memory", "mem:agent 1m ago")

    // when
    state.shuttingDown = true
    ui?.setStatus("memory", "mem:agent 2m ago")
    ui?.notify("memory sync is blocked", "warning")

    // then
    expect(calls).toEqual([
      ["status", "memory", "mem:agent 1m ago"],
      ["notify", "memory sync is blocked", "warning"],
    ])
  })
})
