import { describe, expect, test } from "bun:test"

import { admitWindow, p99 } from "./latency.ts"
import { judgeSelfTest, type Trial } from "./selftest-judge.ts"
import { SIGNALS, type SentinelSummary, type Signal } from "./summary.ts"

function summaryWith(happened: readonly Signal[], faults: readonly string[] = []): SentinelSummary {
  const signals = Object.fromEntries(
    SIGNALS.map((signal) => [
      signal,
      happened.includes(signal)
        ? { signal: "happened" as const, firstAt: 10, count: 1 }
        : { signal: "none" as const, firstAt: null, count: 0 },
    ]),
  )
  return {
    signals: {
      key_focus: signals.key_focus ?? { signal: "none", firstAt: null, count: 0 },
      window_raised: signals.window_raised ?? { signal: "none", firstAt: null, count: 0 },
      typing: signals.typing ?? { signal: "none", firstAt: null, count: 0 },
      pointer: signals.pointer ?? { signal: "none", firstAt: null, count: 0 },
      clipboard: signals.clipboard ?? { signal: "none", firstAt: null, count: 0 },
      space: signals.space ?? { signal: "none", firstAt: null, count: 0 },
      dialog: signals.dialog ?? { signal: "none", firstAt: null, count: 0 },
      activation: signals.activation ?? { signal: "none", firstAt: null, count: 0 },
    },
    faults,
  }
}

const perfect: Trial[] = [
  { plant: null, summary: summaryWith([]) },
  ...SIGNALS.map((signal): Trial => ({ plant: signal, summary: summaryWith([signal]) })),
]
const control = summaryWith(["pointer"])

describe("sentinel self-test judge", () => {
  test("every planted disturbance detected alone and a clean null run pass", () => {
    const result = judgeSelfTest(perfect, control)
    expect(result.lines).toContain("SENTINEL_SELFTEST signals=8 detected=8 null_false_positives=0")
    expect(result.lines).toContain("SENTINEL_NEGATIVE_CONTROL pointer_warp_50px=detected")
    expect(result.exitCode).toBe(0)
  })

  test("a detector that misses its plant fails the self-test and is named", () => {
    const trials = perfect.map((trial) =>
      trial.plant === "window_raised" ? { plant: trial.plant, summary: summaryWith([]) } : trial,
    )
    const result = judgeSelfTest(trials, control)
    expect(result.lines).toContain("detector window_raised missed the planted raise")
    expect(result.lines).toContain("SENTINEL_SELFTEST signals=8 detected=7 null_false_positives=0")
    expect(result.exitCode).toBe(1)
  })

  test("a plant that also trips another signal is not counted as detected", () => {
    const trials = perfect.map((trial) =>
      trial.plant === "activation" ? { plant: trial.plant, summary: summaryWith(["activation", "key_focus"]) } : trial,
    )
    const result = judgeSelfTest(trials, control)
    expect(result.lines).toContain("plant activation also read happened on key_focus")
    expect(result.exitCode).toBe(1)
  })

  test("a signal reading happened on the null run is a false positive", () => {
    const trials = perfect.map((trial) => (trial.plant === null ? { plant: null, summary: summaryWith(["pointer"]) } : trial))
    const result = judgeSelfTest(trials, control)
    expect(result.lines).toContain("SENTINEL_SELFTEST signals=8 detected=8 null_false_positives=1")
    expect(result.exitCode).toBe(1)
  })

  test("an invalid run or a plant that could not be performed never counts as detected", () => {
    const trials: Trial[] = perfect.map((trial) => {
      if (trial.plant === "space") return { plant: "space", failed: "no second Space" }
      if (trial.plant === "clipboard") return { plant: "clipboard", summary: summaryWith(["clipboard"], ["pointer: tap disabled"]) }
      return trial
    })
    const result = judgeSelfTest(trials, control)
    expect(result.lines).toContain("plant Space switch could not be performed: no second Space")
    expect(result.lines).toContain("plant pasteboard write run invalid: pointer: tap disabled")
    expect(result.lines).toContain("SENTINEL_SELFTEST signals=8 detected=6 null_false_positives=0")
    expect(result.exitCode).toBe(1)
  })

  test("a missing plant, a missing null run or a missed negative control fails", () => {
    expect(judgeSelfTest(perfect.slice(0, -1), control).exitCode).toBe(1)
    expect(judgeSelfTest(perfect.slice(1), control).exitCode).toBe(1)
    const missed = judgeSelfTest(perfect, summaryWith([]))
    expect(missed.lines).toContain("SENTINEL_NEGATIVE_CONTROL pointer_warp_50px=missed")
    expect(missed.exitCode).toBe(1)
  })
})

describe("latency-pinned negative windows", () => {
  test("p99 is the nearest-rank 99th percentile", () => {
    expect(p99([5, 1, 3])).toBe(5)
    expect(p99(Array.from({ length: 200 }, (_, index) => index + 1))).toBe(198)
  })

  test("a window below 1.5 times a recorded p99 is refused, naming the action", () => {
    const record = { host: "qa", os: "macos", trials: 10, p99Ms: { raise: 400, "dropped keystroke": 1_200 } }
    expect(admitWindow(2_000, record)).toEqual({
      ok: false,
      reason: "window 2000 ms is below 1.5 x p99 1200 ms of dropped keystroke on qa",
    })
    expect(admitWindow(1_800, { ...record, p99Ms: { raise: 400 } })).toEqual({ ok: true })
  })

  test("a record with no measured action is refused rather than read as fast", () => {
    expect(admitWindow(3_000, { host: "qa", os: "macos", trials: 10, p99Ms: {} })).toEqual({
      ok: false,
      reason: "no recorded latency on qa: calibrate before judging negatives",
    })
  })
})
