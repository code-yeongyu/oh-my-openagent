/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  modeledWallClockSavedMs,
  savedRoundTrips,
  upperBoundSavedMs,
  type MeasurableWave,
} from "./savings-math"

function waveOf(intervals: readonly (readonly [number, number])[]): MeasurableWave {
  const calls = intervals.map(([startMs, endMs]) => ({ startMs, endMs }))
  let minStart = Number.POSITIVE_INFINITY
  let maxEnd = Number.NEGATIVE_INFINITY
  for (const call of calls) {
    minStart = Math.min(minStart, call.startMs)
    maxEnd = Math.max(maxEnd, call.endMs)
  }
  return {
    calls,
    spanMs: calls.length === 0 ? 0 : maxEnd - minStart,
    maxConcurrency: sweepMaxConcurrency(calls),
  }
}

function sweepMaxConcurrency(calls: readonly { startMs: number; endMs: number }[]): number {
  const boundaries: { atMs: number; delta: number }[] = []
  for (const call of calls) {
    boundaries.push({ atMs: call.startMs, delta: 1 })
    boundaries.push({ atMs: call.endMs, delta: -1 })
  }
  boundaries.sort((left, right) => left.atMs - right.atMs || left.delta - right.delta)

  let active = 0
  let peak = 0
  for (const boundary of boundaries) {
    active += boundary.delta
    peak = Math.max(peak, active)
  }
  return peak
}

const SIMULTANEOUS_FOUR = waveOf([
  [0, 2.0],
  [0, 2.2],
  [0, 1.9],
  [0, 2.1],
])
const LONG_TAIL_FOUR = waveOf([
  [0, 0.3],
  [0, 0.3],
  [0, 0.3],
  [0, 9.0],
])
const CHAINED_THREE = waveOf([
  [0, 5],
  [4, 9],
  [8, 12],
])

describe("parallel savings math", () => {
  describe("#given a simultaneously started batch of four calls", () => {
    describe("#when the modeled wall clock saving is computed", () => {
      test("#then it reports the summed duration minus the wave span", () => {
        const saved = modeledWallClockSavedMs(SIMULTANEOUS_FOUR)

        expect(saved.label).toBe("modeled")
        expect(saved.valueMs).toBeCloseTo(6.0, 10)
      })
    })
  })

  describe("#given a long-tail batch where one call dominates", () => {
    describe("#when the modeled and upper bound values are computed", () => {
      test("#then the modeled saving stays honest and differs from the upper bound", () => {
        const modeled = modeledWallClockSavedMs(LONG_TAIL_FOUR)
        const upper = upperBoundSavedMs(LONG_TAIL_FOUR)

        expect(modeled.label).toBe("modeled")
        expect(modeled.valueMs).toBeCloseTo(0.9, 10)
        expect(upper.label).toBe("upper_bound")
        expect(upper.valueMs).toBeCloseTo(7.43, 2)
        expect(upper.valueMs).not.toBeCloseTo(modeled.valueMs, 2)
      })
    })
  })

  describe("#given a wave holding a single call", () => {
    describe("#when the savings are computed", () => {
      test("#then both the modeled and upper bound values are zero", () => {
        const wave = waveOf([[3, 11]])

        expect(modeledWallClockSavedMs(wave).valueMs).toBe(0)
        expect(upperBoundSavedMs(wave).valueMs).toBe(0)
        expect(savedRoundTrips([wave])).toBe(0)
      })
    })
  })

  describe("#given a wave holding no calls at all", () => {
    describe("#when the savings are computed", () => {
      test("#then every metric is zero rather than NaN", () => {
        const wave = waveOf([])

        expect(modeledWallClockSavedMs(wave).valueMs).toBe(0)
        expect(upperBoundSavedMs(wave).valueMs).toBe(0)
        expect(savedRoundTrips([wave])).toBe(0)
        expect(savedRoundTrips([])).toBe(0)
      })
    })
  })

  describe("#given a wave whose reported span exceeds the summed durations", () => {
    describe("#when the modeled saving is computed", () => {
      test("#then the negative result is surfaced instead of clamped to zero", () => {
        const wave: MeasurableWave = {
          calls: [
            { startMs: 0, endMs: 1 },
            { startMs: 0, endMs: 1 },
          ],
          spanMs: 10,
          maxConcurrency: 2,
        }

        expect(modeledWallClockSavedMs(wave).valueMs).toBe(-8)
      })
    })
  })

  describe("#given a chained wave where A overlaps B and B overlaps C", () => {
    describe("#when the modeled saving is computed", () => {
      test("#then it uses the wave span and never the longest single duration", () => {
        const modeled = modeledWallClockSavedMs(CHAINED_THREE)

        expect(modeled.valueMs).toBeCloseTo(2.0, 10)
        expect(modeled.valueMs).not.toBe(9.0)
      })
    })

    describe("#when the saved round trips are counted", () => {
      test("#then it follows max concurrency rather than the call count", () => {
        expect(CHAINED_THREE.maxConcurrency).toBe(2)
        expect(savedRoundTrips([CHAINED_THREE])).toBe(1)
        expect(savedRoundTrips([CHAINED_THREE])).not.toBe(CHAINED_THREE.calls.length - 1)
      })
    })
  })

  describe("#given several waves in one session", () => {
    describe("#when the saved round trips are summed", () => {
      test("#then single-call waves contribute nothing and concurrent waves contribute their peak minus one", () => {
        expect(savedRoundTrips([SIMULTANEOUS_FOUR, CHAINED_THREE, waveOf([[0, 1]])])).toBe(4)
      })
    })
  })

  describe("#given malformed timings inside a wave", () => {
    describe("#when the savings are computed", () => {
      test("#then non-finite and reversed intervals are skipped without leaking NaN", () => {
        const withNaN: MeasurableWave = {
          calls: [
            { startMs: 0, endMs: Number.NaN },
            { startMs: 0, endMs: 4 },
            { startMs: 0, endMs: 4 },
          ],
          spanMs: 4,
          maxConcurrency: 3,
        }
        const withInfinity: MeasurableWave = {
          calls: [
            { startMs: 0, endMs: Number.POSITIVE_INFINITY },
            { startMs: 0, endMs: 4 },
          ],
          spanMs: 4,
          maxConcurrency: 2,
        }
        const withReversed: MeasurableWave = {
          calls: [
            { startMs: 10, endMs: 2 },
            { startMs: 0, endMs: 4 },
          ],
          spanMs: 4,
          maxConcurrency: 2,
        }

        expect(modeledWallClockSavedMs(withNaN).valueMs).toBe(4)
        expect(upperBoundSavedMs(withNaN).valueMs).toBe(4)
        expect(modeledWallClockSavedMs(withInfinity).valueMs).toBe(0)
        expect(upperBoundSavedMs(withInfinity).valueMs).toBe(0)
        expect(modeledWallClockSavedMs(withReversed).valueMs).toBe(0)
        expect(upperBoundSavedMs(withReversed).valueMs).toBe(0)
      })
    })
  })

  describe("#given a malformed wave span or concurrency", () => {
    describe("#when the metrics are computed", () => {
      test("#then a non-finite span or concurrency yields zero instead of throwing", () => {
        const brokenSpan: MeasurableWave = {
          calls: [
            { startMs: 0, endMs: 2 },
            { startMs: 0, endMs: 2 },
          ],
          spanMs: Number.NaN,
          maxConcurrency: 2,
        }
        const brokenConcurrency: MeasurableWave = {
          calls: [{ startMs: 0, endMs: 2 }],
          spanMs: 2,
          maxConcurrency: Number.NaN,
        }

        expect(modeledWallClockSavedMs(brokenSpan).valueMs).toBe(0)
        expect(savedRoundTrips([brokenConcurrency])).toBe(0)
      })
    })
  })

  describe("#given calls listed out of chronological order", () => {
    describe("#when the modeled saving is computed", () => {
      test("#then the result matches the same calls listed in order", () => {
        const ordered = modeledWallClockSavedMs(CHAINED_THREE).valueMs
        const shuffled = modeledWallClockSavedMs({
          calls: [
            { startMs: 8, endMs: 12 },
            { startMs: 0, endMs: 5 },
            { startMs: 4, endMs: 9 },
          ],
          spanMs: CHAINED_THREE.spanMs,
          maxConcurrency: CHAINED_THREE.maxConcurrency,
        }).valueMs

        expect(shuffled).toBe(ordered)
      })
    })
  })

  describe("#given the same wave evaluated repeatedly", () => {
    describe("#when the metrics are recomputed", () => {
      test("#then every run returns identical values with no hidden state", () => {
        const runs = Array.from({ length: 5 }, () => ({
          modeled: modeledWallClockSavedMs(LONG_TAIL_FOUR).valueMs,
          upper: upperBoundSavedMs(LONG_TAIL_FOUR).valueMs,
          trips: savedRoundTrips([LONG_TAIL_FOUR]),
        }))

        expect(new Set(runs.map((run) => `${run.modeled}|${run.upper}|${run.trips}`)).size).toBe(1)
      })
    })
  })
})
