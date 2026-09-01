/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  assembleWaves,
  MAX_TRACKED_CALLS,
  type ToolExecutionObservation,
} from "./wave-assembler"

function start(toolCallId: string, atMs: number, toolName = "bash"): ToolExecutionObservation {
  return { kind: "start", toolCallId, toolName, atMs }
}

function end(toolCallId: string, atMs: number, toolName = "bash"): ToolExecutionObservation {
  return { kind: "end", toolCallId, toolName, atMs }
}

function pair(toolCallId: string, startMs: number, endMs: number, toolName = "bash"): readonly ToolExecutionObservation[] {
  return [start(toolCallId, startMs, toolName), end(toolCallId, endMs, toolName)]
}

function waveShape(result: ReturnType<typeof assembleWaves>): readonly { size: number; spanMs: number; maxConcurrency: number }[] {
  return result.waves.map((wave) => ({
    size: wave.calls.length,
    spanMs: wave.spanMs,
    maxConcurrency: wave.maxConcurrency,
  }))
}

describe("wave assembler", () => {
  describe("#given tool executions that overlap in time", () => {
    describe("#when the observations are assembled", () => {
      test("#then all three calls join one wave carrying a span", () => {
        const result = assembleWaves([
          ...pair("a", 0, 500),
          ...pair("b", 100, 600),
          ...pair("c", 200, 400),
        ])

        expect(waveShape(result)).toEqual([{ size: 3, spanMs: 600, maxConcurrency: 3 }])
        expect(result.waves[0]?.calls.map((call) => call.toolCallId)).toEqual(["a", "b", "c"])
      })
    })
  })

  describe("#given tool executions that never overlap", () => {
    describe("#when the observations are assembled", () => {
      test("#then every call forms its own single-call wave", () => {
        const result = assembleWaves([
          ...pair("a", 0, 100),
          ...pair("b", 200, 300),
          ...pair("c", 400, 500),
        ])

        expect(waveShape(result)).toEqual([
          { size: 1, spanMs: 100, maxConcurrency: 1 },
          { size: 1, spanMs: 100, maxConcurrency: 1 },
          { size: 1, spanMs: 100, maxConcurrency: 1 },
        ])
      })
    })
  })

  describe("#given a mix of overlapping and sequential executions", () => {
    describe("#when the observations are assembled", () => {
      test("#then the overlap forms one wave and the isolated call forms another", () => {
        const result = assembleWaves([
          ...pair("a", 0, 300),
          ...pair("b", 100, 200),
          ...pair("lonely", 900, 950),
        ])

        expect(waveShape(result)).toEqual([
          { size: 2, spanMs: 300, maxConcurrency: 2 },
          { size: 1, spanMs: 50, maxConcurrency: 1 },
        ])
      })
    })
  })

  describe("#given a chained wave where the first and last calls never overlap", () => {
    describe("#when the observations are assembled", () => {
      test("#then one wave reports the full span and a concurrency of two", () => {
        const result = assembleWaves([...pair("a", 0, 5), ...pair("b", 4, 9), ...pair("c", 8, 12)])

        expect(result.waves).toHaveLength(1)
        expect(result.waves[0]?.spanMs).toBe(12)
        expect(result.waves[0]?.maxConcurrency).toBe(2)
      })
    })
  })

  describe("#given a start observation whose end never arrives", () => {
    describe("#when the observations are assembled", () => {
      test("#then the call is counted as incomplete and excluded from waves", () => {
        const result = assembleWaves([...pair("done", 0, 100), start("orphan", 50)])

        expect(result.counters.incomplete).toBe(1)
        expect(result.waves).toHaveLength(1)
        expect(result.waves[0]?.calls.map((call) => call.toolCallId)).toEqual(["done"])
      })
    })
  })

  describe("#given an end observation that precedes its start", () => {
    describe("#when the observations are assembled", () => {
      test("#then the call is counted as a clock anomaly and excluded from waves", () => {
        const result = assembleWaves([...pair("sane", 0, 100), ...pair("reversed", 900, 500)])

        expect(result.counters.clockAnomalies).toBe(1)
        expect(result.counters.pairedCalls).toBe(1)
        expect(result.waves).toHaveLength(1)
        expect(result.waves[0]?.calls.map((call) => call.toolCallId)).toEqual(["sane"])
      })
    })
  })

  describe("#given more tool calls than the session tracking cap", () => {
    describe("#when the observations are assembled", () => {
      test("#then per-call detail is dropped while the counters keep accruing", () => {
        const observations: ToolExecutionObservation[] = []
        const overflow = 10
        for (let index = 0; index < MAX_TRACKED_CALLS + overflow; index += 1) {
          const startMs = index * 10
          observations.push(...pair(`call-${index}`, startMs, startMs + 5))
        }

        const result = assembleWaves(observations)
        const trackedCalls = result.waves.reduce((total, wave) => total + wave.calls.length, 0)

        expect(trackedCalls).toBe(MAX_TRACKED_CALLS)
        expect(result.counters.droppedCalls).toBe(overflow)
        expect(result.counters.observedCalls).toBe(MAX_TRACKED_CALLS + overflow)
      })
    })
  })

  describe("#given every start arriving before any end beyond the tracking cap", () => {
    describe("#when the observations are assembled", () => {
      test("#then resident detail is bounded regardless of arrival order", () => {
        const overflow = 500
        const total = MAX_TRACKED_CALLS + overflow
        const starts: ToolExecutionObservation[] = []
        const ends: ToolExecutionObservation[] = []
        for (let index = 0; index < total; index += 1) {
          starts.push(start(`call-${index}`, index))
          ends.push(end(`call-${index}`, total + index))
        }

        const result = assembleWaves([...starts, ...ends])
        const trackedCalls = result.waves.reduce((sum, wave) => sum + wave.calls.length, 0)

        expect(trackedCalls).toBe(MAX_TRACKED_CALLS)
        expect(result.counters.droppedCalls).toBe(overflow)
        expect(result.counters.observedCalls).toBe(total)
      })
    })
  })

  describe("#given unmatched starts beyond the tracking cap", () => {
    describe("#when the observations are assembled", () => {
      test("#then pending detail is bounded and every start is still accounted for", () => {
        const overflow = 500
        const total = MAX_TRACKED_CALLS + overflow
        const observations: ToolExecutionObservation[] = []
        for (let index = 0; index < total; index += 1) observations.push(start(`call-${index}`, index))

        const result = assembleWaves(observations)

        expect(result.counters.incomplete).toBe(MAX_TRACKED_CALLS)
        expect(result.counters.droppedCalls).toBe(overflow)
        // Every observed start is either paired, still pending, or explicitly dropped.
        expect(result.counters.pairedCalls + result.counters.incomplete + result.counters.droppedCalls).toBe(total)
      })
    })
  })

  describe("#given malformed observations with unusable identifiers and timestamps", () => {
    describe("#when the observations are assembled", () => {
      test("#then nothing throws and the valid pair alone reaches the metrics", () => {
        const malformed = [
          { kind: "start", toolCallId: 42, toolName: "bash", atMs: 0 },
          { kind: "start", toolCallId: "nan", toolName: "bash", atMs: Number.NaN },
          { kind: "end", toolCallId: "nan", toolName: "bash", atMs: 10 },
          { kind: "start", toolCallId: "negative", toolName: "bash", atMs: -5 },
          { kind: "end", toolCallId: "negative", toolName: "bash", atMs: 10 },
          { kind: "start", toolCallId: "", toolName: "bash", atMs: 0 },
          { kind: "end", toolCallId: "missing-ms", toolName: "bash" },
          null,
          "not-an-observation",
        ] as readonly unknown[]

        const run = (): ReturnType<typeof assembleWaves> =>
          assembleWaves([...malformed, ...pair("valid", 0, 100)] as readonly ToolExecutionObservation[])

        expect(run).not.toThrow()
        const result = run()
        // Seven of the nine inputs are structurally unparseable. The two end records for
        // "nan" and "negative" are well-formed observations whose start was rejected, so
        // they are dropped as orphaned ends rather than counted as malformed input.
        const structurallyMalformed = 7
        expect(result.counters.malformed).toBe(structurallyMalformed)
        expect(result.counters.pairedCalls).toBe(1)
        expect(waveShape(result)).toEqual([{ size: 1, spanMs: 100, maxConcurrency: 1 }])
      })
    })
  })

  describe("#given two independent sessions assembled one after another", () => {
    describe("#when the second session is assembled", () => {
      test("#then no state from the first session leaks into the second", () => {
        const first = assembleWaves([...pair("a", 0, 100), ...pair("b", 50, 150), start("orphan", 10)])
        const second = assembleWaves([...pair("a", 0, 10)])

        expect(first.counters.incomplete).toBe(1)
        expect(second.counters.incomplete).toBe(0)
        expect(second.counters.observedCalls).toBe(1)
        expect(waveShape(second)).toEqual([{ size: 1, spanMs: 10, maxConcurrency: 1 }])
      })
    })
  })

  describe("#given observations that arrive out of chronological order", () => {
    describe("#when the observations are assembled", () => {
      test("#then waves are ordered by start time regardless of arrival order", () => {
        const result = assembleWaves([...pair("late", 800, 900), ...pair("early", 0, 100)])

        expect(result.waves.map((wave) => wave.calls[0]?.toolCallId)).toEqual(["early", "late"])
      })
    })
  })

  describe("#given a zero-length execution touching a neighbour boundary", () => {
    describe("#when the observations are assembled", () => {
      test("#then touching intervals share a wave and concurrency stays honest", () => {
        const result = assembleWaves([...pair("a", 0, 100), ...pair("b", 100, 100)])

        expect(result.waves).toHaveLength(1)
        expect(result.waves[0]?.spanMs).toBe(100)
        expect(result.waves[0]?.maxConcurrency).toBe(1)
      })
    })
  })
})
