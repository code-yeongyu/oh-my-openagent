import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  budgetAllows, comparable, digestJson, epochDelta, finalizeReport, percentile, recommendDefault, scoreYield,
  type MeasurementReport, type MeasurementRun,
} from "./measurement"

const digest = "31121b6554593f7f2a24d552ffe39825943b94bcfef78efbe63bcf556ba33f55"
const batch = JSON.parse(readFileSync(join(import.meta.dir, "../../test/fixtures/workpool-real-batch.json"), "utf8")) as {
  readonly batch_sha256: string; readonly source_sha256: string; readonly prompt_sha256: string
  readonly item_order_sha256: string; readonly items: readonly { readonly key: string; readonly repo: string; readonly expected: unknown }[]
}
const caps = digestJson({ width: 2, global_concurrency: 2, default_concurrency: 2, residency_max_children: 2 })
function run(mode: MeasurementRun["mode"], extra: Partial<MeasurementRun> = {}): MeasurementRun {
  return {
    mode, provider: "xai", model: "grok-4.6", batch_sha256: batch.batch_sha256, prompt_sha256: batch.prompt_sha256,
    caps_sha256: caps, item_order_sha256: batch.item_order_sha256, scored_items: 12, correct_items: 12,
    total_tokens: 1000, cost_usd: 1, p95_ms: 10, peak_residents: 2, complete: true, ...extra,
  }
}
function report(extra: Partial<MeasurementReport> = {}, runs?: MeasurementRun[]): MeasurementReport {
  const body = {
    schema_version: 1 as const, plan_sha256: digest, design: "AB/BA" as const, width: 2 as const,
    batch_sha256: batch.batch_sha256, source_sha256: batch.source_sha256, item_count: 12 as const,
    senpi_items: 6 as const, omo_items: 6 as const, token_coverage: true, budget_exhausted: false,
    duplicate_dispatches: 0, uncertain_dispatches: 0,
    runs: runs ?? ["fresh", "keep_alive", "keep_alive", "fresh"].map(mode => run(mode as MeasurementRun["mode"])),
    ...extra,
  }
  return finalizeReport(body)
}

test("#given frozen batch #when fixture is loaded #then twelve pinned items split six/six with independent expected exports", () => {
  expect(batch.items).toHaveLength(12)
  expect(batch.items.filter(item => item.repo === "senpi")).toHaveLength(6)
  expect(batch.items.filter(item => item.repo === "omo")).toHaveLength(6)
  expect(batch.items.map(item => item.key)).toEqual([
    "senpi-reserved-agent-tool", "senpi-runtime-badge", "senpi-bridge-timeout", "senpi-stream-fn",
    "senpi-resolve-tool-path", "senpi-experimental", "omo-once-only", "omo-execution-mode",
    "omo-yield-tool", "omo-dag-directive", "omo-clamp-wait", "omo-runner-error",
  ])
  expect(scoreYield({ export: "onceOnly" }, batch.items[6]?.expected)).toBe(true)
  expect(scoreYield({ export: "wrong" }, batch.items[6]?.expected)).toBe(false)
})

test("#given cumulative run_stats #when an epoch ends #then only the per-epoch delta is billed", () => {
  const before = { total_tokens: 100, input_tokens: 80, output_tokens: 20, cache_read_tokens: 10, cache_write_tokens: 5, cost_usd: 0.2, token_status: "complete", cost_status: "reported" }
  const after = { total_tokens: 250, input_tokens: 200, output_tokens: 50, cache_read_tokens: 40, cache_write_tokens: 15, cost_usd: 0.5, token_status: "complete", cost_status: "reported" }
  expect(epochDelta(before, after)).toEqual({ tokens: 150, cost: 0.3, input: 120, output: 30, cacheRead: 30, cacheWrite: 10, covered: true })
  expect(epochDelta(undefined, after).tokens).toBe(250)
})

test("#given missing usage #when classifying a paired report #then the result is inconclusive", () => {
  expect(epochDelta(undefined, { total_tokens: 10, cost_usd: 1, token_status: "partial", cost_status: "reported" }).covered).toBe(false)
  expect(epochDelta(undefined, { total_tokens: 10, token_status: "complete", cost_status: "unavailable" }).covered).toBe(false)
  expect(epochDelta({ total_tokens: 10, cost_usd: 1, token_status: "complete", cost_status: "reported" }, { total_tokens: 10, cost_usd: 1, token_status: "complete", cost_status: "reported" }).covered).toBe(false)
  expect(report({ token_coverage: false }).status).toBe("inconclusive")
})

test("#given spend ceiling #when the next admission would exceed it #then admission is refused and the report is inconclusive", () => {
  expect(budgetAllows({ cost: 4.9, tokens: 100 }, { max_cost_usd: 5, max_total_tokens: 2000000 })).toBe(true)
  expect(budgetAllows({ cost: 5, tokens: 100 }, { max_cost_usd: 5, max_total_tokens: 2000000 })).toBe(false)
  expect(budgetAllows({ cost: 1, tokens: 2000000 }, { max_cost_usd: 5, max_total_tokens: 2000000 })).toBe(false)
  expect(report({ budget_exhausted: true }, ["fresh", "keep_alive", "keep_alive", "fresh"].map((mode, index) => run(mode as MeasurementRun["mode"], index === 3 ? { complete: false, scored_items: 4, correct_items: 4 } : {}))).status).toBe("inconclusive")
})

test("#given wrong model or batch hash #when pairing arms #then the result is noncomparable", () => {
  expect(report({}, [run("fresh"), run("keep_alive", { model: "grok-4" }), run("keep_alive"), run("fresh")]).status).toBe("inconclusive")
  expect(report({}, [run("fresh"), run("keep_alive", { batch_sha256: "0".repeat(64) }), run("keep_alive"), run("fresh")]).status).toBe("inconclusive")
  expect(comparable(report({}, [run("keep_alive"), run("fresh"), run("fresh"), run("keep_alive")]))).toBe(false)
})

test("#given ack uncertainty or duplicate dispatch #when scoring #then classification fails closed", () => {
  expect(report({ uncertain_dispatches: 1 }).status).toBe("inconclusive")
  expect(report({ duplicate_dispatches: 1 }).status).toBe("inconclusive")
  const zero = report({}, [run("fresh", { total_tokens: 0, cost_usd: 0, p95_ms: 0 }), run("keep_alive"), run("keep_alive"), run("fresh")])
  expect(zero.status).toBe("inconclusive")
  expect(recommendDefault(zero)).toBe("fresh")
})

test("#given zero-capacity first push without fabricated timing #when tokens are absent #then the pair cannot be conclusive", () => {
  expect(report({}, [run("fresh", { complete: false, scored_items: 0, correct_items: 0, total_tokens: 0, cost_usd: 0, p95_ms: 0, peak_residents: 0 }), run("keep_alive"), run("keep_alive"), run("fresh")]).status).toBe("inconclusive")
})

test("#given keep-alive meeting the rule #when recommending a default #then keep_alive wins only without regression", () => {
  const win = report({}, [run("fresh", { cost_usd: 2, p95_ms: 100 }), run("keep_alive", { cost_usd: 0.8, p95_ms: 90 }), run("keep_alive", { cost_usd: 0.8, p95_ms: 95 }), run("fresh", { cost_usd: 2, p95_ms: 110 })])
  expect(win.status).toBe("conclusive")
  expect(recommendDefault(win)).toBe("keep_alive")
  const slow = report({}, [run("fresh", { cost_usd: 2, p95_ms: 100 }), run("keep_alive", { cost_usd: 0.8, p95_ms: 120 }), run("keep_alive", { cost_usd: 0.8, p95_ms: 90 }), run("fresh", { cost_usd: 2, p95_ms: 100 })])
  expect(recommendDefault(slow)).toBe("fresh")
  const costly = report({}, [run("fresh", { cost_usd: 1, p95_ms: 100 }), run("keep_alive", { cost_usd: 0.95, p95_ms: 90 }), run("keep_alive", { cost_usd: 0.95, p95_ms: 90 }), run("fresh", { cost_usd: 1, p95_ms: 100 })])
  expect(recommendDefault(costly)).toBe("fresh")
  const regression = report({}, [run("fresh", { correct_items: 12 }), run("keep_alive", { correct_items: 11 }), run("keep_alive", { correct_items: 12 }), run("fresh", { correct_items: 12 })])
  expect(recommendDefault(regression)).toBe("fresh")
})

test("#given wall samples #when computing p95 #then the rank is deterministic", () => {
  expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 50)).toBe(6)
  expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 95)).toBe(12)
})
