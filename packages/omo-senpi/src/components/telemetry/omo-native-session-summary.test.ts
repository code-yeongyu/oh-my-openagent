import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"

import {
  CHECKPOINT_MAX_TURNS,
  CHECKPOINT_MAX_WINDOW_MS,
  createSessionSummaryRecorder,
  isSessionSampled,
  type SummaryTurn,
} from "./omo-native-session-summary"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"
import { createSummaryStore, rollupDir } from "./session-summary-store"
import { percentile } from "./session-summary-window"

type Captured = { readonly name: string; readonly properties: EventTelemetryProperties }

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-summary-"))
  dirs.push(dir)
  return dir
}

function turn(overrides: Partial<SummaryTurn> = {}): SummaryTurn {
  return {
    turnIndex: 0, provider: "openai", modelId: "gpt-5.5", inputTokens: 10, outputTokens: 20, cacheReadTokens: 3,
    cacheWriteTokens: 4, reasoningTokens: 5, totalTokens: 40, costUsd: 0.01, usageValid: true, stopReason: "stop",
    toolResultCount: 2, toolErrorCount: 0, ...overrides,
  }
}

function recorder(input: { readonly dir?: string; readonly sampleRate?: number; readonly pid?: number; readonly alive?: boolean } = {}) {
  const captured: Captured[] = []
  let clock = 1_000
  const dir = input.dir ?? stateDir()
  const summary = createSessionSummaryRecorder({
    captureEvent: (name, properties) => captured.push({ name, properties }),
    store: createSummaryStore({ stateDir: dir, pid: input.pid ?? process.pid, isAlive: () => input.alive ?? true }),
    now: () => clock,
    sampleRate: input.sampleRate ?? 0.05,
  })
  return { captured, summary, dir, advance: (ms: number) => { clock += ms } }
}

const seqs = (captured: readonly Captured[]) => captured.map(({ properties }) => [properties.summary_seq, properties.ended_by, properties.turns])

describe("session_summary windows", () => {
  test("#given three turns on two models #when the session quits #then one final row carries exact sums and per-model totals", () => {
    const { captured, summary, advance } = recorder()

    summary.recordTurn("s1", turn({ turnIndex: 0, totalTokens: 10, costUsd: 0.1 }))
    advance(500)
    summary.recordTurn("s1", turn({ turnIndex: 1, totalTokens: 30, costUsd: 0.2, stopReason: "error", toolErrorCount: 1 }))
    advance(500)
    summary.recordTurn("s1", turn({ turnIndex: 2, totalTokens: 20, costUsd: 0.3, modelId: "claude-opus-5", provider: "anthropic" }))
    summary.finish("s1", "quit")

    expect(captured).toHaveLength(1)
    expect(captured[0]?.properties).toMatchObject({
      $session_id: "s1", summary_seq: 0, is_final: true, ended_by: "shutdown", session_role: "main", turns: 3,
      window_ms: 1_000, total_tokens: 60, total_tokens_p50: 20, total_tokens_p95: 30, total_tokens_max: 30,
      cost_usd: 0.6, error_turns: 1, tool_result_count: 6, tool_error_count: 1, model_count: 2,
      m1_provider: "openai", m1_model: "gpt-5.5", m1_turns: 2, m1_total_tokens: 40, m1_cost_usd: 0.3,
      m2_provider: "anthropic", m2_model: "claude-opus-5", m2_turns: 1, m2_total_tokens: 20,
      m3_model: "none", m3_turns: 0, other_turns: 0,
    })
    expect(Object.keys(captured[0]?.properties ?? {}).toSorted()).toEqual([...OMO_NATIVE_PROPERTY_ALLOWLISTS.session_summary].toSorted())
  })

  test("#given five models #when summarized #then the top three keep their totals and the rest fold into other_*", () => {
    const { captured, summary } = recorder()
    const models = ["a", "a", "a", "b", "b", "c", "d", "e"]
    models.forEach((modelId, index) => summary.recordTurn("s1", turn({ turnIndex: index, modelId, totalTokens: 1, costUsd: 1 })))
    summary.finish("s1", "quit")

    const row = captured[0]?.properties ?? {}
    expect([row.m1_turns, row.m2_turns, row.m3_turns, row.other_turns]).toEqual([3, 2, 1, 2])
    expect(Number(row.m1_total_tokens) + Number(row.m2_total_tokens) + Number(row.m3_total_tokens) + Number(row.other_total_tokens)).toBe(Number(row.total_tokens))
  })

  test("#given more turns than one window holds #when checkpoints fire #then summing the rows reproduces every turn once", () => {
    const { captured, summary } = recorder()
    const turns = CHECKPOINT_MAX_TURNS * 2 + 7

    for (let index = 0; index < turns; index += 1) summary.recordTurn("s1", turn({ turnIndex: index, totalTokens: index }))
    summary.finish("s1", "quit")

    expect(seqs(captured).map(([seq, endedBy]) => [seq, endedBy])).toEqual([[0, "checkpoint"], [1, "checkpoint"], [2, "shutdown"]])
    const sum = (key: string) => captured.reduce((total, { properties }) => total + Number(properties[key]), 0)
    expect(sum("turns")).toBe(turns)
    expect(sum("total_tokens")).toBe((turns * (turns - 1)) / 2)
  })

  test("#given a long idle window #when the next turn arrives after the time limit #then the window is checkpointed", () => {
    const { captured, summary, advance } = recorder()
    summary.recordTurn("s1", turn({ turnIndex: 0 }))
    advance(CHECKPOINT_MAX_WINDOW_MS)
    summary.recordTurn("s1", turn({ turnIndex: 1 }))
    expect(seqs(captured)).toEqual([[0, "checkpoint", 2]])
  })

  test("#given a session that ended right after a checkpoint #when it quits #then an empty final row still marks the end", () => {
    const { captured, summary } = recorder()
    for (let index = 0; index < CHECKPOINT_MAX_TURNS; index += 1) summary.recordTurn("s1", turn({ turnIndex: index }))
    summary.finish("s1", "quit")
    expect(seqs(captured)).toEqual([[0, "checkpoint", CHECKPOINT_MAX_TURNS], [1, "shutdown", 0]])
  })

  test("#given a session with no turns #when it quits #then nothing is sent and no rollup file is left", () => {
    const { captured, summary, dir } = recorder()
    summary.finish("s1", "quit")
    expect(captured).toHaveLength(0)
    expect(existsSync(rollupDir(dir)) ? readdirSync(rollupDir(dir)) : []).toEqual([])
  })
})

describe("session_summary across reload and crash", () => {
  test("#given a reload mid-session #when the next registration continues #then seq never repeats and the reload row is not final", () => {
    const dir = stateDir()
    const first = recorder({ dir })
    first.summary.recordTurn("s1", turn({ turnIndex: 0 }))
    first.summary.finish("s1", "reload")
    const second = recorder({ dir })
    second.summary.recordTurn("s1", turn({ turnIndex: 1 }))
    second.summary.finish("s1", "quit")

    expect(seqs(first.captured)).toEqual([[0, "reload", 1]])
    expect(first.captured[0]?.properties.is_final).toBe(false)
    expect(seqs(second.captured)).toEqual([[1, "shutdown", 1]])
  })

  test("#given a process that died with an open window #when another process records its first turn #then the window is sent once as recovered", () => {
    const dir = stateDir()
    const crashed = recorder({ dir, pid: 999_999 })
    crashed.summary.recordTurn("dead", turn({ turnIndex: 0, totalTokens: 7 }))
    crashed.summary.recordTurn("dead", turn({ turnIndex: 1, totalTokens: 5 }))

    const next = recorder({ dir, alive: false })
    const racing = recorder({ dir, alive: false })
    next.summary.recordTurn("live", turn())
    racing.summary.recordTurn("other", turn())

    const recovered = [...next.captured, ...racing.captured].filter(({ properties }) => properties.ended_by === "recovered")
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.properties).toMatchObject({ $session_id: "dead", summary_seq: 0, turns: 2, total_tokens: 12, is_final: false })
  })

  test("#given a crashed session that is resumed #when it records again #then its seq continues after the recovered row", () => {
    const dir = stateDir()
    recorder({ dir, pid: 999_998 }).summary.recordTurn("s1", turn({ turnIndex: 0 }))
    const resumed = recorder({ dir, alive: false })
    resumed.summary.recordTurn("s1", turn({ turnIndex: 1 }))
    resumed.summary.finish("s1", "quit")
    expect(seqs(resumed.captured)).toEqual([[0, "recovered", 1], [1, "shutdown", 1]])
  })

  test("#given a corrupt rollup file from a dead process #when recovery runs #then it is skipped and the live session still reports", () => {
    const dir = stateDir()
    recorder({ dir, pid: 999_997 }).summary.recordTurn("s1", turn())
    for (const name of readdirSync(rollupDir(dir))) writeFileSync(join(rollupDir(dir), name), "{not json")
    const next = recorder({ dir, alive: false })
    next.summary.recordTurn("s2", turn())
    next.summary.finish("s2", "quit")
    expect(seqs(next.captured)).toEqual([[0, "shutdown", 1]])
  })
})

describe("session_summary review findings", () => {
  test("#given process C recovers a crashed session #when the user resumes it in process B #then seq continues and the recovered row is not final", () => {
    const dir = stateDir()
    const deadPid = 999_990
    recorder({ dir, pid: deadPid }).summary.recordTurn("s1", turn({ turnIndex: 0 }))
    const c = recorder({ dir, pid: 111_111, alive: false })
    c.summary.recordTurn("other", turn())
    const bCaptured: Captured[] = []
    const b = createSessionSummaryRecorder({
      captureEvent: (name, properties) => bCaptured.push({ name, properties }),
      store: createSummaryStore({ stateDir: dir, pid: 222_222, isAlive: (pid) => pid !== deadPid }),
      sampleRate: 0.05,
    })
    b.recordTurn("s1", turn({ turnIndex: 1 }))
    b.finish("s1", "quit")

    const recovered = c.captured.find(({ properties }) => properties.ended_by === "recovered")
    expect(recovered?.properties).toMatchObject({ $session_id: "s1", summary_seq: 0, is_final: false })
    expect(seqs(bCaptured)).toEqual([[1, "shutdown", 1]])
  })

  test("#given a checkpoint #when the window is sent #then the closed window was already removed from disk", () => {
    const dir = stateDir()
    const store = createSummaryStore({ stateDir: dir })
    const order: string[] = []
    const summary = createSessionSummaryRecorder({
      captureEvent: () => order.push(`emit:${store.read("s1")?.window === null ? "persisted" : "stale"}`),
      store,
      sampleRate: 0,
    })
    for (let index = 0; index < CHECKPOINT_MAX_TURNS; index += 1) summary.recordTurn("s1", turn({ turnIndex: index }))
    expect(order).toEqual(["emit:persisted"])
  })

  test("#given leftover temp and claim files of dead processes #when recovery runs #then they are deleted", () => {
    const dir = stateDir()
    recorder({ dir, pid: 999_991 }).summary.recordTurn("s1", turn())
    writeFileSync(join(rollupDir(dir), "s9.json.999992.tmp"), "{}")
    writeFileSync(join(rollupDir(dir), "s8.json.claimed-999993"), "{}")
    recorder({ dir, alive: false }).summary.recordTurn("s2", turn())
    expect(readdirSync(rollupDir(dir)).filter((name) => name.includes(".tmp") || name.includes(".claimed-"))).toEqual([])
  })

  // #10229: a rollup written before consent was recorded (or by an opted-out session) carries no
  // opted-in mark, so nothing proves its session agreed to be sent: recovery deletes it unsent.
  test("#given a dead process's rollup without a consent mark #when recovery runs #then it is deleted and never sent", () => {
    const dir = stateDir()
    recorder({ dir, pid: 999_995 }).summary.recordTurn("legacy", turn())
    const path = join(rollupDir(dir), "legacy.json")
    const unmarked: Record<string, unknown> = JSON.parse(readFileSync(path, "utf8"))
    Reflect.deleteProperty(unmarked, "consent")
    writeFileSync(path, JSON.stringify(unmarked))
    const next = recorder({ dir, alive: false })
    next.summary.recordTurn("s2", turn())
    next.summary.finish("s2", "quit")
    expect(next.captured.filter(({ properties }) => properties.$session_id === "legacy")).toEqual([])
    expect(readdirSync(rollupDir(dir))).toEqual([])
  })

  test("#given a session that sent seq 0, opted out, and opted back in #when it sends again #then it never reuses a sent seq", () => {
    const captured: Captured[] = []
    let consent = true
    const summary = createSessionSummaryRecorder({
      captureEvent: (name, properties) => captured.push({ name, properties }),
      store: createSummaryStore({ stateDir: stateDir() }),
      isConsented: () => consent,
      sampleRate: 0,
    })
    summary.recordTurn("s1", turn())
    summary.finish("s1", "reload")
    consent = false
    summary.recordTurn("s1", turn({ turnIndex: 1 }))
    consent = true
    summary.recordTurn("s1", turn({ turnIndex: 2 }))
    summary.finish("s1", "quit")
    expect(seqs(captured)).toEqual([[0, "reload", 1], [1, "shutdown", 1]])
  })

  test("#given an orphan with no window and nothing sent #when its session resumes #then seq starts at 0", () => {
    const dir = stateDir()
    createSummaryStore({ stateDir: dir, pid: 999_994 }).write({ sessionHash: "s1", sessionRole: "main", nextSeq: 0, window: null, consent: "enabled", scope: {} })
    const resumed = recorder({ dir, alive: false })
    resumed.summary.recordTurn("s1", turn())
    resumed.summary.finish("s1", "quit")
    expect(seqs(resumed.captured)).toEqual([[0, "shutdown", 1]])
  })
})

describe("raw turn sampling", () => {
  test("#given the same session hash #when asked from two recorders #then the decision never changes", () => {
    const hashes = Array.from({ length: 200 }, (_, index) => `session-${index}`)
    const first = hashes.map((hash) => isSessionSampled(hash, 0.05))
    const again = hashes.map((hash) => recorder().summary.isRawTurnSampled(hash))
    expect(again).toEqual(first)
  })

  test("#given 20,000 sessions #when sampled at 5% #then close to 5% are chosen", () => {
    let chosen = 0
    for (let index = 0; index < 20_000; index += 1) if (isSessionSampled(`h${index}`, 0.05)) chosen += 1
    expect(chosen / 20_000).toBeGreaterThan(0.04)
    expect(chosen / 20_000).toBeLessThan(0.06)
  })

  test("#given rates of 0 and 1 #when sampling #then none and all are chosen", () => {
    expect(isSessionSampled("any", 0)).toBe(false)
    expect(isSessionSampled("any", 1)).toBe(true)
  })
})

describe("percentile", () => {
  test("#given values #when asked for nearest-rank percentiles #then it returns members of the set", () => {
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([7], 0.95)).toBe(7)
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
    expect(percentile(Array.from({ length: 100 }, (_, index) => index + 1), 0.95)).toBe(95)
  })
})
