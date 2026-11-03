import { describe, expect, it } from "bun:test"
import { formatDurationHuman } from "./format-duration"

describe("formatDurationHuman", () => {
  // given
  for (const [milliseconds, expected] of [
    [0, "0s"],
    [999, "0s"],
    [1000, "1s"],
    [60_000, "1m 0s"],
    [3_600_000, "1h 0m 0s"],
    [3_723_456, "1h 2m 3s"],
    [86_400_000, "24h 0m 0s"],
  ] as const) {
    it(`formats ${milliseconds}ms as ${expected}`, () => {
      // when
      const result = formatDurationHuman(milliseconds)

      // then
      expect(result).toBe(expected)
    })
  }
})
