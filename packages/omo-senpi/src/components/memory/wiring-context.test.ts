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

  it("#given a session manager without getEntryCount #when the count is read #then it falls back to getEntries().length", () => {
    const eventCtx = { sessionManager: { getEntries: () => [1, 2, 3] } }

    expect(branchEntryCount(eventCtx)).toBe(3)
  })

  it("#given no session manager #when the count is read #then it is zero", () => {
    expect(branchEntryCount({})).toBe(0)
    expect(branchEntryCount(undefined)).toBe(0)
  })
})
