import { describe, expect, test } from "bun:test"

import {
  applyTargetOverrides,
  DEFAULT_TARGETS,
  evaluate,
  LATENCY_SCENARIOS,
  nearestRank,
  summarizeSamples,
} from "./task-host-e2e-shard-cost-eval.mjs"

const twenty = (base) => Array.from({ length: 20 }, (_, index) => base + index * 10)

function completeReport() {
  const latency = Object.fromEntries(LATENCY_SCENARIOS.map((name) => [name, summarizeSamples(twenty(1_000))]))
  const variant = (sharded, control) => ({ sharded, control })
  return {
    mode: "full",
    sections: {
      idle: { sharded: { endpoint_rss_mb: 150, endpoint_footprint_mb: 120 }, control: { endpoint_rss_mb: 160 } },
      marginal: { per_child: [{ children: 1, host_rss_mb: 300, marginal_rss_mb: 150 }] },
      totals: { rows: [{ parents: 1, sharded_rss_mb: 500, control_rss_mb: 450 }] },
      idle_exit: {
        d1: variant({ all_gone: true }, { all_gone: true }),
        d2_default: variant(
          { departed_gone: true, survivor_alive: true, alive_rss_mb_at_16min: 300 },
          { host_alive: true, retained: 0, alive_rss_mb_at_16min: 400 },
        ),
        d2_long: variant(
          { departed_gone: true, survivor_alive: true, alive_rss_mb_at_16min: 300 },
          { host_alive: true, retained: 4, alive_rss_mb_at_16min: 700 },
        ),
      },
      latency: { scenarios: latency },
      prewarm_idle: {
        default: { host_exited: true, parent_alive_at_host_exit: true, idle: { endpoint_footprint_mb: 120 } },
        session_start: { host_exited: true, parent_alive_at_host_exit: true, idle: { endpoint_footprint_mb: 120 } },
      },
    },
  }
}

describe("nearest-rank percentiles", () => {
  test("p95 of 20 samples is the 19th smallest and p50 the 10th", () => {
    const samples = twenty(100).reverse()
    expect(nearestRank(samples, 95)).toBe(280)
    expect(nearestRank(samples, 50)).toBe(190)
    const cell = summarizeSamples(samples)
    expect(cell.samples_ms).toHaveLength(20)
    expect(cell.min_ms).toBe(100)
  })
})

describe("evaluate", () => {
  test("a complete run whose every target row passes exits 0", () => {
    const result = evaluate(completeReport())
    expect(result.exitCode).toBe(0)
    expect(result.rows.every((row) => row.verdict === "PASS")).toBe(true)
    expect(result.rows.map((row) => row.id).sort()).toEqual(Object.keys(DEFAULT_TARGETS).sort())
  })

  test("an impossible injected target exits 2 with exactly that row FAIL", () => {
    const result = evaluate(completeReport(), { targets: applyTargetOverrides(DEFAULT_TARGETS, ["idle_footprint_mb=1"]) })
    expect(result.exitCode).toBe(2)
    expect(result.rows.filter((row) => row.verdict === "FAIL").map((row) => row.id)).toEqual(["idle_footprint_mb"])
  })

  test("a failed boolean assertion (d1) is a FAIL row, exit 2", () => {
    const report = completeReport()
    report.sections.idle_exit.d1.control.all_gone = false
    const result = evaluate(report)
    expect(result.exitCode).toBe(2)
    expect(result.rows.find((row) => row.id === "d1_both_idled_out").verdict).toBe("FAIL")
  })

  test("a disabled section exits 1 even when every remaining row passes", () => {
    const report = completeReport()
    delete report.sections.totals
    const result = evaluate(report)
    expect(result.exitCode).toBe(1)
    expect(result.completeness.missingSections).toEqual(["totals"])
  })

  test("a null cell exits 1", () => {
    const report = completeReport()
    report.sections.marginal.per_child[0].marginal_rss_mb = null
    const result = evaluate(report)
    expect(result.exitCode).toBe(1)
    expect(result.completeness.nullCells).toEqual(["marginal.per_child[0].marginal_rss_mb"])
  })

  test("three samples per scenario is below the required twenty: exit 1", () => {
    const report = completeReport()
    for (const name of LATENCY_SCENARIOS) report.sections.latency.scenarios[name] = summarizeSamples([900, 950, 1_000])
    const result = evaluate(report)
    expect(result.exitCode).toBe(1)
    expect(result.completeness.shortSamples).toHaveLength(LATENCY_SCENARIOS.length)
  })

  test("a default pre-warm first child slower than the control's at p95 only fails exactly that parity row", () => {
    const report = completeReport()
    report.sections.latency.scenarios.user_first_child_control = summarizeSamples(twenty(1_000))
    report.sections.latency.scenarios.user_first_child_default = summarizeSamples([...twenty(1_000).slice(0, 18), 1_900, 5_000])
    const result = evaluate(report)
    expect(result.exitCode).toBe(2)
    expect(result.rows.filter((row) => row.verdict === "FAIL").map((row) => row.id)).toEqual(["user_first_child_p95_vs_control"])
  })

  test("a pre-warmed host that outlives its idle window, or dies with its parent, in either mode fails the idle-exit row", () => {
    const breaks = [(idle) => { idle.host_exited = false }, (idle) => { idle.parent_alive_at_host_exit = false }]
    for (const [mode, breakIt] of ["default", "session_start"].flatMap((name) => breaks.map((fn) => [name, fn]))) {
      const report = completeReport()
      breakIt(report.sections.prewarm_idle[mode])
      const result = evaluate(report)
      expect(result.exitCode).toBe(2)
      expect(result.rows.filter((row) => row.verdict === "FAIL").map((row) => row.id)).toEqual(["prewarm_idle_host_exits"])
    }
  })

  test("the control-only mode judges its own three rows", () => {
    const report = { mode: "control", sections: { idle_exit: completeReport().sections.idle_exit } }
    expect(evaluate(report).exitCode).toBe(0)
    report.sections.idle_exit.d2_long.control.retained = 0
    expect(evaluate(report).exitCode).toBe(2)
  })
})
