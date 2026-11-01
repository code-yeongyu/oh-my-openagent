import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { FactsFailureRecord } from "@oh-my-opencode/memory-core"

import { factsParkedCauseSummary } from "./facts-failure-cause"
import {
  factsRemediationHint,
  formatFactsAdvisory,
  formatFactsStatus,
  type FactsOverview,
} from "./facts-status"

const NOW = new Date("2026-08-16T12:00:00.000Z")

function backoffRecord(overrides: Partial<FactsFailureRecord> = {}): FactsFailureRecord {
  return {
    conversationId: "conv-a",
    end_message_id: "msg-a",
    end_snapshot_line: 4,
    state: "backoff",
    streak: 2,
    firstFailureAt: "2026-08-16T11:00:00.000Z",
    lastFailureAt: "2026-08-16T11:50:00.000Z",
    lastReason: "child_exit",
    lastFailureId: "run-1",
    nextEligibleAt: "2026-08-16T12:12:00.000Z",
    ...overrides,
  }
}

function parkedRecord(overrides: Partial<FactsFailureRecord> = {}): FactsFailureRecord {
  return {
    conversationId: "conv-b",
    end_message_id: "msg-b",
    end_snapshot_line: 9,
    state: "parked",
    streak: 5,
    firstFailureAt: "2026-08-16T09:00:00.000Z",
    lastFailureAt: "2026-08-16T11:00:00.000Z",
    lastReason: "deadline_exceeded",
    lastFailureId: "run-5",
    nextEligibleAt: null,
    parkedAt: "2026-08-16T11:00:00.000Z",
    ...overrides,
  }
}

function overview(overrides: Partial<FactsOverview> = {}): FactsOverview {
  return { pending: 0, records: [], now: NOW, ...overrides }
}

const tempFactsDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempFactsDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

/** A real run dir whose ledger names `batchId`; the dir name deliberately differs from it. */
async function seedFactsRun(factsDir: string, runName: string, batchId: string): Promise<string> {
  const runDir = join(factsDir, "runs", runName)
  await mkdir(runDir, { recursive: true })
  await writeFile(
    join(runDir, "ledger.json"),
    `${JSON.stringify({ version: 1, runId: runName, kind: "facts", batchId, queued: [] }, null, 2)}\n`,
    "utf8",
  )
  return runDir
}

async function tempFactsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "facts-run-path-"))
  tempFactsDirs.push(dir)
  return dir
}

describe("facts status rendering", () => {
  test("#given parked and backoff records #when rendering the advisory #then one bounded line names both counts", () => {
    // given
    const state = overview({
      records: [parkedRecord(), parkedRecord({ end_message_id: "msg-c" }), parkedRecord({ end_message_id: "msg-d" }), backoffRecord()],
    })

    // when
    const line = formatFactsAdvisory(state)

    // then
    expect(line).toBe("facts: 3 parked / 1 backoff (next 12m)")
  })

  test("#given no failure records #when rendering the advisory #then nothing is shown", () => {
    // given
    const state = overview({ pending: 2 })

    // when
    const line = formatFactsAdvisory(state)

    // then
    expect(line).toBeUndefined()
  })

  test("#given a corrupt ledger #when rendering the advisory #then it says corrupt instead of zeros", () => {
    // given
    const state = overview({ corrupt: "unexpected token" })

    // when
    const line = formatFactsAdvisory(state)

    // then
    expect(line).toBe("facts: failure ledger unreadable (run /facts for detail)")
  })

  test("#given a corrupt ledger #when rendering the status view #then it reports corruption and no counts", async () => {
    // given
    const state = overview({ pending: 3, corrupt: "unexpected token } in JSON at position 4" })

    // when
    const text = formatFactsStatus("agent-x", state)

    // then
    expect(text).toContain("failure ledger is UNREADABLE")
    expect(text).toContain("unexpected token")
    expect(text).toContain("launches are blocked")
    expect(text).not.toContain("parked: 0")
    expect(text).not.toContain("backoff: 0")
  })

  test("#given failing conversations #when rendering the status view #then counts and bounded per-conversation reasons appear", () => {
    // given
    const many: FactsFailureRecord[] = Array.from({ length: 7 }, (_, index) =>
      parkedRecord({
        conversationId: `conv-${index}`,
        end_message_id: `msg-${index}`,
        lastFailureAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
        lastDetail: `boom ${index}\nsecond line`,
      }),
    )
    const state = overview({ pending: 9, records: [...many, backoffRecord()] })

    // when
    const text = formatFactsStatus("agent-x", state)
    const lines = text.split("\n")

    // then
    expect(text).toContain("queued: 9 pending")
    expect(text).toContain("parked: 7")
    expect(text).toContain("backoff: 1 (next eligible 12m)")
    expect(lines.filter((line) => line.startsWith("- conv-")).length).toBe(5)
    expect(text).toContain("boom 0")
    expect(text).not.toContain("second line")
    expect(text).toContain("/facts retry")
  })

  test("#given a parked record whose batch id names a surviving run ledger #when rendering the status view #then its row names the real run dir and that dir exists", async () => {
    // given: the failure id is a batch id, not the run dir name, so the ledger is the lookup key
    const factsDir = await tempFactsDir()
    const runDir = await seedFactsRun(factsDir, "facts-deadbeef-2", "batch-abc-2")
    const state = overview({ records: [parkedRecord({ lastFailureId: "batch-abc-2" })], factsDir })

    // when
    const text = formatFactsStatus("agent-x", state)

    // then
    expect(text).toContain(`(last run: ${runDir})`)
    expect(existsSync(runDir)).toBe(true)
  })

  test("#given a parked record whose run was pruned #when rendering the status view #then its row names no run path", async () => {
    // given: no runs/*/ledger.json carries this batch id, so no path may be printed
    const factsDir = await tempFactsDir()
    const state = overview({ records: [parkedRecord({ lastFailureId: "batch-pruned" })], factsDir })

    // when
    const text = formatFactsStatus("agent-x", state)

    // then
    expect(text).not.toContain("last run:")
  })

  test("#given a healthy queue #when rendering the status view #then no failure section is shown", () => {
    // given
    const state = overview({ pending: 1 })

    // when
    const text = formatFactsStatus("agent-x", state)

    // then
    expect(text).toContain("queued: 1 pending")
    expect(text).toContain("no failing batches")
    expect(text).not.toContain("parked:")
  })
})

describe("facts remediation hint", () => {
  test("#given parked records with a transient cause #when asking for the hint #then the to-do is /facts retry itself", () => {
    // given
    const state = overview({ records: [parkedRecord(), parkedRecord({ end_message_id: "msg-z" })] })

    // when
    const hint = factsRemediationHint(state)

    // then: assert only the machine-meaningful part, so wording changes do not break the test
    expect(hint).toContain("/facts retry")
  })

  test("#given a parked record whose fix is a setting #when asking for the hint #then the to-do names that setting", () => {
    // given
    const state = overview({ records: [parkedRecord({ lastReason: "quick_category_unavailable" })] })

    // when
    const hint = factsRemediationHint(state)

    // then
    expect(hint).toContain("memory.facts.model")
    expect(hint).toContain("/facts retry")
  })

  test("#given a parked record whose fix has no setting #when asking for the hint #then the to-do names the cause", () => {
    // given
    const state = overview({ records: [parkedRecord({ lastReason: "invalid_extraction" })] })

    // when
    const hint = factsRemediationHint(state)

    // then
    expect(hint).toContain("parse error")
    expect(hint).toContain("/facts retry")
  })

  test("#given only backoff records #when asking for the hint #then it reports the wait instead of a remedy", () => {
    // given
    const state = overview({ records: [backoffRecord()] })

    // when
    const hint = factsRemediationHint(state)

    // then
    expect(hint).toBe("1 facts batch is backing off; next attempt in 12m")
  })

  test("#given a clean ledger #when asking for the hint #then there is no hint", () => {
    // given
    const state = overview()

    // when + then
    expect(factsRemediationHint(state)).toBeUndefined()
  })
})

describe("facts parked cause summary", () => {
  test("#given parked batches with known causes #when summarizing #then counts per cause and the newest run path appear", async () => {
    // given: only the newest batch has a surviving run ledger, keyed by its batch id
    const factsDir = await tempFactsDir()
    const runDir = await seedFactsRun(factsDir, "facts-deadbeef-3", "batch-a-3")
    const records = [
      parkedRecord({ end_message_id: "msg-1", lastFailureId: "batch-a-1", lastFailureAt: "2026-08-16T10:00:00.000Z" }),
      parkedRecord({ end_message_id: "msg-2", lastFailureId: "batch-a-2", lastFailureAt: "2026-08-16T10:30:00.000Z" }),
      parkedRecord({
        end_message_id: "msg-3",
        lastReason: "invalid_extraction",
        lastFailureId: "batch-a-3",
        lastFailureAt: "2026-08-16T11:00:00.000Z",
      }),
    ]

    // when
    const summary = factsParkedCauseSummary(records, factsDir)

    // then
    expect(summary).toBe(`causes: timeout x2, parse error x1; last run: ${runDir}`)
    expect(existsSync(runDir)).toBe(true)
  })

  test("#given a parked batch with an unknown cause #when summarizing #then the run path still appears with no guessed cause", async () => {
    // given
    const factsDir = await tempFactsDir()
    const runDir = await seedFactsRun(factsDir, "facts-zz-9", "batch-z-7")
    const records = [parkedRecord({ lastReason: "other", lastFailureId: "batch-z-7" })]

    // when
    const summary = factsParkedCauseSummary(records, factsDir)

    // then
    expect(summary).toBe(`last run: ${runDir}`)
  })

  test("#given only backoff records #when summarizing #then there is no parked summary", () => {
    // given
    const records = [backoffRecord()]

    // when + then
    expect(factsParkedCauseSummary(records, "/ident/facts")).toBeUndefined()
  })
})
