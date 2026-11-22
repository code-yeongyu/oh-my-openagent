import { describe, expect, it } from "bun:test"
import { branchEntryCount } from "./wiring-context"

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

  it("#given a manager without a cheap count #when the count is read #then it stays unknown without reading history", () => {
    const eventCtx = {
      sessionManager: {
        getEntries: () => {
          throw new Error("counting must not materialize history")
        },
      },
    }

    expect(branchEntryCount(eventCtx)).toBeUndefined()
  })

  it("#given no session manager #when the count is read #then it is zero", () => {
    expect(branchEntryCount({})).toBe(0)
    expect(branchEntryCount(undefined)).toBe(0)
  })
})
