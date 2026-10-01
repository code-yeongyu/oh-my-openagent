import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDecisionLedger, DecisionLedgerError } from "./ledger"
import { PROMPT_EXCERPT_CAP } from "./types"

const testDirectories: string[] = []

afterEach(() => {
  while (testDirectories.length > 0) {
    const directory = testDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function createTestDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-decision-ledger-"))
  testDirectories.push(directory)
  return directory
}

function baseEntry() {
  return {
    session: "sess_test",
    task: { description: "route a task", promptExcerpt: "do the thing" },
    resolved: { path: "quick", effort: 1, model: "m", lane: "fast" },
    source: "jev" as const,
    usage: { inputTokens: 10, costUsd: 0.001 },
  }
}

describe("createDecisionLedger", () => {
  test("#given a fresh ledger #when recording #then the line parses back with id and ts", () => {
    // given
    const directory = createTestDirectory()
    const ledger = createDecisionLedger({ filePath: join(directory, "decision-ledger.jsonl"), now: () => 1_700_000_000_000 })

    // when
    const { id, ts } = ledger.record(baseEntry())

    // then
    const raw = readFileSync(join(directory, "decision-ledger.jsonl"), "utf-8")
    const parsed = JSON.parse(raw.trim())
    expect(parsed.id).toBe(id)
    expect(parsed.ts).toBe(ts)
    expect(ts).toBe(1_700_000_000_000)
    expect(parsed.session).toBe("sess_test")
  })

  test("#given a long prompt excerpt #when recording #then it is capped at 2000 chars", () => {
    // given
    const directory = createTestDirectory()
    const ledger = createDecisionLedger({ filePath: join(directory, "decision-ledger.jsonl") })
    const longExcerpt = "x".repeat(PROMPT_EXCERPT_CAP + 500)

    // when
    ledger.record({ ...baseEntry(), task: { description: "d", promptExcerpt: longExcerpt } })

    // then
    const raw = readFileSync(join(directory, "decision-ledger.jsonl"), "utf-8")
    const parsed = JSON.parse(raw.trim())
    expect(parsed.task.promptExcerpt.length).toBe(PROMPT_EXCERPT_CAP)
  })

  test("#given a missing parent directory #when recording #then it is created automatically", () => {
    // given
    const directory = createTestDirectory()
    const nestedPath = join(directory, "deep", "nested", "decision-ledger.jsonl")
    const ledger = createDecisionLedger({ filePath: nestedPath })

    // when
    ledger.record(baseEntry())

    // then
    expect(existsSync(nestedPath)).toBe(true)
  })

  test("#given two recorded entries #when backfilling an outcome #then only the matching line is updated", () => {
    // given
    const directory = createTestDirectory()
    const ledger = createDecisionLedger({ filePath: join(directory, "decision-ledger.jsonl") })
    const first = ledger.record(baseEntry())
    ledger.record(baseEntry())

    // when
    const ok = ledger.backfillOutcome({
      decisionId: first.id,
      status: "success",
      durationMs: 42,
    })

    // then
    expect(ok).toBe(true)
    const raw = readFileSync(join(directory, "decision-ledger.jsonl"), "utf-8")
    const lines = raw.trim().split("\n").map(l => JSON.parse(l))
    expect(lines[0]?.outcome?.status).toBe("success")
    expect(lines[0]?.outcome?.durationMs).toBe(42)
    expect(lines[1]?.outcome).toBeUndefined()
  })

  test("#given an unknown decision id #when backfilling #then it returns false and leaves the file intact", () => {
    // given
    const directory = createTestDirectory()
    const ledger = createDecisionLedger({ filePath: join(directory, "decision-ledger.jsonl") })
    ledger.record(baseEntry())
    const before = readFileSync(join(directory, "decision-ledger.jsonl"), "utf-8")

    // when
    const ok = ledger.backfillOutcome({ decisionId: "nonexistent", status: "failure", durationMs: 1 })

    // then
    expect(ok).toBe(false)
    expect(readFileSync(join(directory, "decision-ledger.jsonl"), "utf-8")).toBe(before)
  })

  test("#given accumulated spend in one month #when the month rolls over #then monthlySpendUsd resets", () => {
    // given
    const directory = createTestDirectory()
    let clock = Date.parse("2026-01-15T00:00:00.000Z")
    const ledger = createDecisionLedger({
      filePath: join(directory, "decision-ledger.jsonl"),
      now: () => clock,
    })
    ledger.accumulate(1.0)
    expect(ledger.monthlySpendUsd()).toBe(1.0)

    // when
    clock = Date.parse("2026-02-01T00:00:00.000Z")

    // then
    expect(ledger.monthlySpendUsd()).toBe(0)
  })

  test("#given repeated accumulation #when reading spend #then it sums within the same month", () => {
    // given
    const directory = createTestDirectory()
    const ledger = createDecisionLedger({ filePath: join(directory, "decision-ledger.jsonl") })
    ledger.accumulate(0.5)
    ledger.accumulate(0.25)

    // then
    expect(ledger.monthlySpendUsd()).toBeCloseTo(0.75, 5)
  })

  test("#given a ledger at the size cap #when recording #then the old file is rotated to .1", () => {
    // given
    const directory = createTestDirectory()
    const ledgerPath = join(directory, "decision-ledger.jsonl")
    const ledger = createDecisionLedger({ filePath: ledgerPath, maxFileBytes: 10 })
    ledger.record(baseEntry())
    expect(existsSync(ledgerPath)).toBe(true)

    // when
    ledger.record(baseEntry())

    // then
    expect(existsSync(`${ledgerPath}.1`)).toBe(true)
    const rotated = readFileSync(`${ledgerPath}.1`, "utf-8")
    expect(rotated.trim().split("\n").length).toBeGreaterThanOrEqual(1)
    const active = readFileSync(ledgerPath, "utf-8")
    expect(active.trim().length).toBeGreaterThan(0)
  })

  test("#given an unwritable parent path #when recording #then a DecisionLedgerError is thrown", () => {
    // given
    const directory = createTestDirectory()
    writeFileSync(join(directory, "blocker"), "not a directory")
    const ledger = createDecisionLedger({
      filePath: join(directory, "blocker", "decision-ledger.jsonl"),
    })

    // when / then
    expect(() => ledger.record(baseEntry())).toThrow(DecisionLedgerError)
  })
})
