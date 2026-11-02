import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  CHECKPOINT_MAX_TURNS,
  CHECKPOINT_MAX_WINDOW_MS,
  isSessionSampled,
} from "./omo-native-session-summary"
import { OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"
import * as sidecar from "./session-summary-recovery"
import { OWNER_STALE_MS, summaryDir } from "./session-summary-storage"
import { createTempStateDirs, createTestRecorder, rows, summaryKeys, summaryTurn } from "./session-summary.test-support"
import { percentile } from "./session-summary-window"

const stateDirs = createTempStateDirs()
afterEach(() => stateDirs.cleanup())

const recorder = (input: { readonly sampleRate?: number } = {}) => createTestRecorder({ dir: stateDirs.make(), ...input })

// The race: this process read the dead owner's file, but a third process renamed it away before this claim.
const claimLostToAnotherProcess = async () => ({
  ...sidecar,
  createRecoveryRuntime: (input: Parameters<typeof sidecar.createRecoveryRuntime>[0]) => {
    const storage = { ...sidecar.withRecoveryOps(input.storage), claimWindow: () => undefined }
    return { ...sidecar.createRecoveryRuntime(input), adopt: (args: Parameters<sidecar.RecoveryRuntime["adopt"]>[0]) => sidecar.adoptForeignWindow({ ...args, storage }) }
  },
})

describe("session_summary windows", () => {
  test("#given three turns on two models #when the session quits #then one final row carries exact sums and per-model totals", async () => {
    const { published, summary, advance } = recorder()

    await summary.recordTurn("s1", summaryTurn({ turnIndex: 0, totalTokens: 10, cost1e4: 1_000 }))
    advance(500)
    await summary.recordTurn("s1", summaryTurn({ turnIndex: 1, totalTokens: 30, cost1e4: 2_000, stopReason: "error", toolErrorCount: 1 }))
    advance(500)
    await summary.recordTurn("s1", summaryTurn({ turnIndex: 2, totalTokens: 20, cost1e4: 3_000, modelId: "claude-opus-5", provider: "anthropic" }))
    await summary.finish("s1", "quit")

    expect(published).toHaveLength(1)
    expect(published[0]?.properties).toMatchObject({
      $session_id: "s1", summary_seq: 0, is_final: true, ended_by: "shutdown", session_role: "root", turns: 3,
      window_ms: 1_000, total_tokens: 60, total_tokens_p50: 20, total_tokens_p95: 30, total_tokens_max: 30,
      cost_1e4: 6_000, cost_usd: 0.6, dropped_events: 0, error_turns: 1, tool_result_count: 6, tool_error_count: 1, model_count: 2,
      m1_provider: "openai", m1_model: "gpt-5.5", m1_turns: 2, m1_total_tokens: 40, m1_cost_usd: 0.3,
      m2_provider: "anthropic", m2_model: "claude-opus-5", m2_turns: 1, m2_total_tokens: 20,
      m3_model: "none", m3_turns: 0, other_turns: 0,
    })
    expect(Object.keys(published[0]?.properties ?? {}).toSorted()).toEqual([...OMO_NATIVE_PROPERTY_ALLOWLISTS.session_summary].toSorted())
  })

  test("#given five models #when summarized #then the top three keep their totals and the rest fold into other_*", async () => {
    const { published, summary } = recorder()
    const models = ["a", "a", "a", "b", "b", "c", "d", "e"]
    for (const [index, modelId] of models.entries()) await summary.recordTurn("s1", summaryTurn({ turnIndex: index, modelId, totalTokens: 1 }))
    await summary.finish("s1", "quit")

    const row = published[0]?.properties ?? {}
    expect([row.m1_turns, row.m2_turns, row.m3_turns, row.other_turns]).toEqual([3, 2, 1, 2])
    expect(Number(row.m1_total_tokens) + Number(row.m2_total_tokens) + Number(row.m3_total_tokens) + Number(row.other_total_tokens)).toBe(Number(row.total_tokens))
  })

  test("#given more turns than one window holds #when checkpoints fire #then summing the rows reproduces every turn once, each under its own uuid", async () => {
    const { published, summary } = recorder()
    const turns = CHECKPOINT_MAX_TURNS * 2 + 7

    for (let index = 0; index < turns; index += 1) await summary.recordTurn("s1", summaryTurn({ turnIndex: index, totalTokens: index }))
    await summary.finish("s1", "quit")

    expect(rows(published).map(([seq, endedBy]) => [seq, endedBy])).toEqual([[0, "checkpoint"], [1, "checkpoint"], [2, "shutdown"]])
    const sum = (key: string) => published.reduce((total, { properties }) => total + Number(properties[key]), 0)
    expect(sum("turns")).toBe(turns)
    expect(sum("total_tokens")).toBe((turns * (turns - 1)) / 2)
    expect(new Set(published.map(({ uuid }) => uuid)).size).toBe(3)
  })

  test("#given a long idle window #when the next turn arrives after the time limit #then the window is checkpointed", async () => {
    const { published, summary, advance } = recorder()
    await summary.recordTurn("s1", summaryTurn({ turnIndex: 0 }))
    advance(CHECKPOINT_MAX_WINDOW_MS)
    await summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    expect(rows(published)).toEqual([[0, "checkpoint", 2]])
  })

  test("#given a session that ended right after a checkpoint #when it quits #then an empty final row still marks the end", async () => {
    const { published, summary } = recorder()
    for (let index = 0; index < CHECKPOINT_MAX_TURNS; index += 1) await summary.recordTurn("s1", summaryTurn({ turnIndex: index }))
    await summary.finish("s1", "quit")
    expect(rows(published)).toEqual([[0, "checkpoint", CHECKPOINT_MAX_TURNS], [1, "shutdown", 0]])
  })

  test("#given a session with no turns #when it quits #then nothing is sent and no window file is left", async () => {
    const { published, summary, dir } = recorder()
    await summary.finish("s1", "quit")
    expect(published).toHaveLength(0)
    const dirOf = summaryDir(dir)
    expect(existsSync(dirOf) ? readdirSync(dirOf).filter((name) => name.endsWith(".json")) : []).toEqual([])
  })

  test("#given a reload mid-session #when the next registration continues #then seq never repeats and the reload row is not final", async () => {
    const dir = stateDirs.make()
    const first = createTestRecorder({ dir })
    await first.summary.recordTurn("s1", summaryTurn({ turnIndex: 0 }))
    await first.summary.finish("s1", "reload")
    const second = createTestRecorder({ dir })
    await second.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    await second.summary.finish("s1", "quit")

    expect(rows(first.published)).toEqual([[0, "reload", 1]])
    expect(first.published[0]?.properties.is_final).toBe(false)
    expect(rows(second.published)).toEqual([[1, "shutdown", 1]])
  })

  test("#given a session that quit cleanly #when it is resumed later #then its numbering continues instead of restarting at 0", async () => {
    const dir = stateDirs.make()
    const first = createTestRecorder({ dir })
    await first.summary.recordTurn("s1", summaryTurn())
    await first.summary.finish("s1", "quit")
    const resumed = createTestRecorder({ dir })
    await resumed.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    await resumed.summary.finish("s1", "quit")
    expect(rows(resumed.published)).toEqual([[1, "shutdown", 1]])
  })

  test("#given a dead owner's window that another process claims first #when this process records a turn #then it keeps its own copy and never writes the shared file", async () => {
    const dir = stateDirs.make()
    const dead = createTestRecorder({ dir, pid: 111 })
    await dead.summary.recordTurn("s1", summaryTurn())
    const shared = join(summaryDir(dir), "s1.json")
    const before = readFileSync(shared, "utf8")

    const live = createTestRecorder({ dir, pid: 222, loadRecovery: claimLostToAnotherProcess })
    await live.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))

    expect(readFileSync(shared, "utf8")).toBe(before)
    expect(existsSync(join(summaryDir(dir), "s1@boot-222.json"))).toBe(true)
  })

  // The collector deduplicates session_summary rows on (session, summary_epoch, summary_seq): a process that
  // keeps its own copy beside another process's window must never publish a pair that process uses.
  test("#given a live owner continuing a session #when a second process keeps its own copy #then the two never publish the same (epoch, seq)", async () => {
    const dir = stateDirs.make()
    const owner = createTestRecorder({ dir, pid: 111, alivePids: [222] })
    const second = createTestRecorder({ dir, pid: 222, alivePids: [111] })
    await owner.summary.recordTurn("s1", summaryTurn())
    await second.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    await owner.summary.finish("s1", "quit")
    await second.summary.finish("s1", "quit")

    const keys = summaryKeys([...owner.published, ...second.published])
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
    expect(existsSync(join(summaryDir(dir), "seq"))).toBe(false)
  })

  test("#given a dead owner's window another process wins the claim on #when this process keeps its own copy #then its (epoch, seq) differs from the recovered one", async () => {
    const dir = stateDirs.make()
    const dead = createTestRecorder({ dir, pid: 111 })
    await dead.summary.recordTurn("s1", summaryTurn())
    const live = createTestRecorder({ dir, pid: 222, alivePids: [333], loadRecovery: claimLostToAnotherProcess })
    await live.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    await live.summary.finish("s1", "quit")
    const winner = createTestRecorder({ dir, pid: 333, alivePids: [222], startAt: 1_000_000 + OWNER_STALE_MS + 1 })
    await winner.summary.recover()

    expect(rows(winner.published)).toEqual([[0, "recovered", 1]])
    const recovered = summaryKeys(winner.published)
    expect(summaryKeys(live.published).filter((key) => recovered.includes(key))).toEqual([])
  })

  // #10229: a window written before consent was recorded (or by an opted-out session) carries no opted-in
  // mark, so nothing proves its session agreed to be sent: recovery deletes it unsent.
  test("#given a dead process's window without a consent mark #when recovery runs #then it is deleted and never sent", async () => {
    const dir = stateDirs.make()
    await createTestRecorder({ dir, pid: 111 }).summary.recordTurn("legacy", summaryTurn())
    const path = join(summaryDir(dir), "legacy.json")
    const unmarked: Record<string, unknown> = JSON.parse(readFileSync(path, "utf8"))
    Reflect.deleteProperty(unmarked, "consent")
    writeFileSync(path, JSON.stringify({ ...unmarked, heartbeatAt: 0 }))
    const next = createTestRecorder({ dir, pid: 222, startAt: 1_000_000 + OWNER_STALE_MS + 1 })
    await next.summary.recordTurn("s2", summaryTurn())
    await next.summary.finish("s2", "quit")
    expect(next.published.filter(({ properties }) => properties.$session_id === "legacy")).toEqual([])
    expect(existsSync(path)).toBe(false)
  })

  test("#given a session that sent seq 0, opted out, and opted back in #when it sends again #then no (epoch, seq) pair repeats and nothing of it stayed on disk", async () => {
    let consent = true
    const dir = stateDirs.make()
    const { published, summary } = createTestRecorder({ dir, isConsented: () => consent })
    await summary.recordTurn("s1", summaryTurn())
    await summary.finish("s1", "reload")
    consent = false
    await summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    const left = readdirSync(summaryDir(dir), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    expect(left.map((entry) => entry.name).filter((name) => !/^\d+\.json$/.test(name))).toEqual([])
    consent = true
    await summary.recordTurn("s1", summaryTurn({ turnIndex: 2 }))
    await summary.finish("s1", "quit")
    const keys = summaryKeys(published)
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })

  test("#given a session that reloads #when both rows are published #then each carries a 16-hex summary_epoch, the continued window keeps it, and no seq reservation is written", async () => {
    const dir = stateDirs.make()
    const first = createTestRecorder({ dir })
    await first.summary.recordTurn("s1", summaryTurn())
    await first.summary.finish("s1", "reload")
    await first.summary.recordTurn("s1", summaryTurn({ turnIndex: 1 }))
    await first.summary.finish("s1", "quit")

    const epochs = first.published.map(({ properties }) => properties.summary_epoch)
    expect(rows(first.published)).toEqual([[0, "reload", 1], [1, "shutdown", 1]])
    for (const epoch of epochs) expect(String(epoch)).toMatch(/^[0-9a-f]{16}$/)
    expect(new Set(epochs).size).toBe(1)
    expect(existsSync(join(summaryDir(dir), "seq"))).toBe(false)
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
