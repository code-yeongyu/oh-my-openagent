import { test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  createCostTrackerHook,
  recordCost,
  calculateCost,
  readCostLog,
  summarizeCosts,
  COST_TRACKER_HOOK_NAME,
  type CostRecord,
} from "./hook"

let dir: string
let cwd: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cost-"))
  cwd = process.cwd()
  process.chdir(dir)
})

afterEach(() => {
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})

test("given a cost tracker hook, when created, then it has the expected shape", () => {
  const hook = createCostTrackerHook()
  expect(typeof hook["experimental.chat.messages.transform"]).toBe("function")
})

test("given a known model key, when calculateCost is called, then it returns non-zero costs", () => {
  const cost = calculateCost("claude-sonnet-4-6", 1000, 500)
  expect(cost.inputCost).toBeGreaterThan(0)
  expect(cost.outputCost).toBeGreaterThan(0)
  expect(cost.total).toBe(cost.inputCost + cost.outputCost)
})

test("given an unknown model key, when calculateCost is called, then it falls back to default pricing", () => {
  const cost = calculateCost("unknown-model-v1", 1000, 500)
  expect(cost.total).toBeGreaterThan(0)
})

test("given a cost record, when recordCost is called, then it appends to the log with a timestamp", () => {
  recordCost({
    session_id: "sess-1",
    agent: "sisyphus",
    model: "claude-sonnet-4-6",
    provider: "anthropic",
    input_tokens: 1000,
    output_tokens: 500,
    input_cost: 0.003,
    output_cost: 0.0075,
    total_cost: 0.0105,
  })
  const log = readCostLog()
  expect(log.length).toBe(1)
  expect(log[0].session_id).toBe("sess-1")
  expect(log[0].total_cost).toBe(0.0105)
  expect(typeof log[0].timestamp).toBe("string")
  expect(log[0].timestamp).toContain("T")
})

test("given multiple records across sessions, when summarizeCosts is called on a filtered list, then it only counts that session", () => {
  const rec = (session_id: string, total: number): Omit<CostRecord, "timestamp"> => ({
    session_id,
    agent: "a",
    model: "m",
    provider: "p",
    input_tokens: 100,
    output_tokens: 50,
    input_cost: 0.001,
    output_cost: 0.002,
    total_cost: total,
  })
  recordCost(rec("sess-1", 0.003))
  recordCost(rec("sess-2", 0.006))
  recordCost(rec("sess-1", 0.0015))
  const summary = summarizeCosts(readCostLog().filter((r) => r.session_id === "sess-1"))
  expect(summary.records).toBe(2)
  expect(summary.totalCost).toBeCloseTo(0.0045, 6)
  expect(summary.bySession["sess-1"].calls).toBe(2)
  expect(summary.bySession["sess-2"]).toBeUndefined()
})

test("given the cost tracker hook name, then it is cost-tracker", () => {
  expect(COST_TRACKER_HOOK_NAME).toBe("cost-tracker")
})
