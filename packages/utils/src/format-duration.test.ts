import { describe, expect, it } from "bun:test"
import { formatDurationHuman } from "./format-duration"

describe("formatDurationHuman", () => {
  it("returns 0s for 0ms", () => {
    expect(formatDurationHuman(0)).toBe("0s")
  })

  it("returns 0s for 999ms", () => {
    expect(formatDurationHuman(999)).toBe("0s")
  })

  it("returns 0s for non-finite durations", () => {
    expect(formatDurationHuman(Number.NaN)).toBe("0s")
    expect(formatDurationHuman(Number.POSITIVE_INFINITY)).toBe("0s")
  })

  it("returns 1s for 1000ms", () => {
    expect(formatDurationHuman(1000)).toBe("1s")
  })

  it("returns 1m 0s for 60_000ms", () => {
    expect(formatDurationHuman(60_000)).toBe("1m 0s")
  })

  it("returns 1h 0m 0s for 3_600_000ms", () => {
    expect(formatDurationHuman(3_600_000)).toBe("1h 0m 0s")
  })

  it("returns 1h 2m 3s for 3_723_456ms", () => {
    expect(formatDurationHuman(3_723_456)).toBe("1h 2m 3s")
  })

  it("returns 24h 0m 0s for 86_400_000ms", () => {
    expect(formatDurationHuman(86_400_000)).toBe("24h 0m 0s")
  })
})
