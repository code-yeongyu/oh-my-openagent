import { describe, it, expect, beforeEach } from "bun:test"
import { getMcbAvailability, markMcbUnavailable, resetMcbAvailability } from "./availability"

describe("mcb-integration/availability", () => {
  beforeEach(() => {
    resetMcbAvailability()
  })

  //#given a fresh state
  //#when getMcbAvailability is called
  //#then it returns default availability with session disabled
  it("returns default availability status", () => {
    const status = getMcbAvailability()
    expect(status.available).toBe(true)
    expect(status.tools.search).toBe(true)
    expect(status.tools.memory).toBe(true)
    expect(status.tools.index).toBe(true)
    expect(status.tools.validate).toBe(true)
    expect(status.tools.vcs).toBe(true)
    expect(status.tools.session).toBe(false)
    expect(status.checkedAt).toBeGreaterThan(0)
  })

  //#given a cached status
  //#when getMcbAvailability is called again within TTL
  //#then it returns the cached result
  it("returns cached result within TTL", () => {
    const first = getMcbAvailability()
    const second = getMcbAvailability()
    expect(first.checkedAt).toBe(second.checkedAt)
  })

  //#given an available MCB
  //#when markMcbUnavailable is called with a specific tool
  //#then that tool is marked unavailable
  it("marks specific tool unavailable", () => {
    getMcbAvailability()
    markMcbUnavailable("memory")
    const status = getMcbAvailability()
    expect(status.tools.memory).toBe(false)
    expect(status.tools.search).toBe(true)
  })

  //#given an available MCB
  //#when markMcbUnavailable is called without args
  //#then the entire MCB is marked unavailable
  it("marks entire MCB unavailable", () => {
    getMcbAvailability()
    markMcbUnavailable()
    const status = getMcbAvailability()
    expect(status.available).toBe(false)
  })

  //#given a modified availability
  //#when resetMcbAvailability is called
  //#then the next call returns fresh defaults
  it("resets availability to defaults", () => {
    getMcbAvailability()
    markMcbUnavailable("search")
    resetMcbAvailability()
    const status = getMcbAvailability()
    expect(status.tools.search).toBe(true)
  })
})
