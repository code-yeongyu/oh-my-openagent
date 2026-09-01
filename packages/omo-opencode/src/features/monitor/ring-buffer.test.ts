import { describe, expect, test } from "bun:test"

import { MonitorRingBuffer } from "./ring-buffer"
import type { OutputLine } from "./types"

function createLine(seq: number, text = `line-${seq}`): OutputLine {
  return {
    stream: "stdout",
    seq,
    text,
  }
}

describe("MonitorRingBuffer", () => {
  describe("#given more matched lines than the cap", () => {
    test("#when pushing into the matched ring #then it drops oldest matched lines and counts drops", () => {
      // given
      const buffer = new MonitorRingBuffer({ ringMaxLines: 3 })

      // when
      for (let seq = 1; seq <= 5; seq += 1) {
        buffer.push(createLine(seq), true)
      }

      // then
      const result = buffer.query({ stream: "matched" })
      expect(result.lines.map((line) => line.seq)).toEqual([3, 4, 5])
      expect(result.lines).toHaveLength(3)
      expect(result.counters.droppedMatched).toBe(2)
      expect(result.counters.bytesDropped).toBe("line-1".length + "line-2".length)
    })
  })

  describe("#given matched lines across several sequences", () => {
    test("#when querying matched lines since a sequence #then it returns only newer lines", () => {
      // given
      const buffer = new MonitorRingBuffer({ ringMaxLines: 10 })
      for (let seq = 1; seq <= 4; seq += 1) {
        buffer.push(createLine(seq), true)
      }

      // when
      const result = buffer.query({ stream: "matched", since_sequence: 2 })

      // then
      expect(result.lines.map((line) => line.seq)).toEqual([3, 4])
    })
  })

  describe("#given matched and unmatched lines arrive out of order", () => {
    test("#when querying all lines #then it merges both rings by sequence", () => {
      // given
      const buffer = new MonitorRingBuffer({ ringMaxLines: 10 })
      buffer.push(createLine(3, "matched-3"), true)
      buffer.push(createLine(1, "unmatched-1"), false)
      buffer.push(createLine(4, "unmatched-4"), false)
      buffer.push(createLine(2, "matched-2"), true)

      // when
      const result = buffer.query({ stream: "all" })

      // then
      expect(result.lines.map((line) => line.seq)).toEqual([1, 2, 3, 4])
    })
  })

  describe("#given matched overflow has occurred", () => {
    test("#when reading counters #then totals, matched count, drops, and last sequence stay accurate", () => {
      // given
      const buffer = new MonitorRingBuffer({ ringMaxLines: 2 })

      // when
      buffer.push(createLine(2, "two"), true)
      buffer.push(createLine(4, "four"), true)
      buffer.push(createLine(3, "three"), true)
      buffer.push(createLine(1, "one"), false)

      // then
      expect(buffer.getCounters()).toEqual({
        totalLines: 4,
        matchedLines: 3,
        unmatchedLines: 1,
        droppedMatched: 1,
        droppedUnmatched: 0,
        bytesDropped: "two".length,
        lastSequence: 4,
      })
    })
  })

  describe("#given more lines than requested", () => {
    test("#when querying with a limit #then it returns the most recent lines", () => {
      // given
      const buffer = new MonitorRingBuffer({ ringMaxLines: 10 })
      for (let seq = 1; seq <= 5; seq += 1) {
        buffer.push(createLine(seq), seq % 2 === 0)
      }

      // when
      const result = buffer.query({ stream: "all", limit: 2 })

      // then
      expect(result.lines.map((line) => line.seq)).toEqual([4, 5])
    })
  })

  describe("#given lines and counters exist", () => {
    test("#when resetting #then rings and counters return to empty state", () => {
      // given
      const buffer = new MonitorRingBuffer({ ringMaxLines: 2 })
      buffer.push(createLine(1), true)
      buffer.push(createLine(2), false)

      // when
      buffer.reset()

      // then
      expect(buffer.query({ stream: "all" })).toEqual({
        lines: [],
        counters: {
          totalLines: 0,
          matchedLines: 0,
          unmatchedLines: 0,
          droppedMatched: 0,
          droppedUnmatched: 0,
          bytesDropped: 0,
          lastSequence: 0,
        },
      })
    })
  })
})
