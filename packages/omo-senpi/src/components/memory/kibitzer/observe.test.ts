import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import { acquireLock, buildIdentityPaths, containsSecretLikeMaterial, createLockRecord, releaseLock } from "@oh-my-opencode/memory-core"
import type { RunnerOutcome } from "@oh-my-opencode/senpi-task"

import { createMemoryBinding } from "../binding"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "../context"
import { GATE_ENTRY_TYPE, GATE_REASON_MAX_CHARS, type KibitzerGateRecord } from "./notice"
import {
  KIBITZER_PERSISTENT_FAILURE_THRESHOLD,
  KIBITZER_SIDECAR_RETENTION_MS,
  KIBITZER_WAKE_RECORD_MAX_CHARS,
  KIBITZER_WAKES_FILENAME,
  createKibitzerObservability,
  decodeKibitzerSidecarDirName,
  kibitzerSidecarOwnerLockPath,
  kibitzerSidecarSessionDir,
  kibitzerWakesFile,
  pruneKibitzerSidecars,
  type KibitzerWakeRecord,
} from "./observe"
import type { KibitzerWakeOutcome } from "./sidecar-outcome"
import { candidate, sidecarHarness, SESSION_ID, withinMs } from "./sidecar.test-support"

const IDENTITY = "kibitzer-observe-agent"
const K8S = "reference/kubernetes-rollouts.md"
const HINT = "Drain nodes before a rollout."
const DAY_MS = 24 * 60 * 60 * 1000
/** Fake token shapes: they match the redaction patterns without resembling any issued credential. */
const FAKE_GITHUB_TOKEN = `ghp_${"FAKE".repeat(6)}0000`
const FAKE_SK_TOKEN = "sk-test-not-a-real-key-000000"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omo-kibitzer-observe-"))
  roots.push(root)
  return root
}

function contextFor(root: string): MemoryIdentityContext {
  const identityPaths = buildIdentityPaths(join(root, "memory"), IDENTITY)
  return createMemoryIdentityContext({
    identity: IDENTITY,
    identityPaths,
    binding: createMemoryBinding({ identity: IDENTITY, repoPath: identityPaths.repo, boundAt: 1 }),
  })
}

interface Fixture {
  readonly root: string
  readonly context: MemoryIdentityContext
  readonly entries: Array<{ readonly customType: string; readonly data: unknown }>
  readonly warnings: Array<{ readonly message: string; readonly details: unknown }>
  readonly observe: ReturnType<typeof createKibitzerObservability>
  readonly clock: { now: number }
  /** Waits for every queued write, lock transition and sweep (an explicit signal, never a sleep). */
  idle(): Promise<void>
  /** Parsed `wakes.ndjson` lines of a session, in file order. */
  wakes(sessionId: string): Promise<KibitzerWakeRecord[]>
  gates(): KibitzerGateRecord[]
}

async function fixture(): Promise<Fixture> {
  const root = await tempRoot()
  const context = contextFor(root)
  const entries: Fixture["entries"] = []
  const warnings: Fixture["warnings"] = []
  const clock = { now: Date.UTC(2026, 8, 11, 12, 0, 0) }
  const observe = createKibitzerObservability({
    appendEntry: (customType, data) => { entries.push({ customType, data }) },
    now: () => clock.now,
    logger: { info: () => {}, warn: (message, details) => { warnings.push({ message, details }) }, error: () => {} },
  })
  return {
    root,
    context,
    entries,
    warnings,
    observe,
    clock,
    idle: () => withinMs(observe.whenIdle(), "observability idle"),
    async wakes(sessionId) {
      const text = await readFile(kibitzerWakesFile(context.identityPaths.recall, sessionId), "utf8")
      expect(text.endsWith("\n")).toBe(true)
      return text.trimEnd().split("\n").map((line) => JSON.parse(line) as KibitzerWakeRecord)
    },
    gates: () => entries.filter((entry) => entry.customType === GATE_ENTRY_TYPE).map((entry) => entry.data as KibitzerGateRecord),
  }
}

function outcome(overrides: Partial<KibitzerWakeOutcome> & Pick<KibitzerWakeOutcome, "wake" | "status">): KibitzerWakeOutcome {
  const failed = overrides.status === "failed"
  return {
    sessionId: SESSION_ID,
    generation: 1,
    nudges: [],
    candidateCount: 2,
    steered: 0,
    toolCalls: 1,
    durationMs: 1_200,
    slotWaitMs: 0,
    cursors: { first: 1, last: 3 },
    contextTokens: 1_800,
    model: "omo-mock/mock-1",
    diagnostic: failed,
    ...(failed ? { cause: "child_failed_upstream" as const, reason: "503 overloaded" } : {}),
    ...overrides,
  }
}

const completed: RunnerOutcome = { status: "completed", finalResponse: "", model: "omo-mock/mock-1" }

/** Backdates every entry of a sidecar directory (and the directory itself) so it reads as idle since `at`. */
async function backdate(dir: string, at: number): Promise<void> {
  const stamp = new Date(at)
  for (const name of await readdir(dir)) await utimes(join(dir, name), stamp, stamp)
  await utimes(dir, stamp, stamp)
}

async function sidecarDirWithTranscript(context: MemoryIdentityContext, sessionId: string, idleSince: number): Promise<string> {
  const dir = kibitzerSidecarSessionDir(context.identityPaths.recall, sessionId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, "20260901T000000_child.jsonl"), `${JSON.stringify({ type: "session", id: "child" })}\n`)
  await writeFile(join(dir, KIBITZER_WAKES_FILENAME), `${JSON.stringify({ version: 1, wake: 1, status: "completed" })}\n`)
  await backdate(dir, idleSince)
  return dir
}

describe("kibitzer sidecar directory identity", () => {
  test("#given parent session ids that differ only by characters base64url encodes differently (distinct session directory) #when their directories are derived #then every directory is distinct, path-safe and decodes back to its exact id", () => {
    const recall = join("/state", "runtime", "recall")
    const ids = ["a/b", "a-b", "a_b", "a+b", "a b", "a?b", "YS1i", "session-1", "session-1\n", "세션-1", "x".repeat(70)]
    const dirs = ids.map((id) => kibitzerSidecarSessionDir(recall, id))

    expect(new Set(dirs).size).toBe(ids.length)
    for (const [index, dir] of dirs.entries()) {
      expect(dirname(dir)).toBe(join(recall, "sidecars"))
      expect(basename(dir)).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(decodeKibitzerSidecarDirName(basename(dir))).toBe(ids[index])
    }
    // "a-b" encodes to "YS1i": a session literally named "YS1i" still gets its own directory.
    expect(basename(kibitzerSidecarSessionDir(recall, "a-b"))).toBe("YS1i")
    expect(basename(kibitzerSidecarSessionDir(recall, "YS1i"))).toBe("WVMxaQ")
    expect(decodeKibitzerSidecarDirName("not base64url!")).toBeUndefined()
    expect(decodeKibitzerSidecarDirName(".prune-YS1i")).toBeUndefined()
    // The wake log and the owner lock follow the same encoding, so they can never collide either.
    expect(kibitzerWakesFile(recall, "a/b")).toBe(join(recall, "sidecars", "YS9i", KIBITZER_WAKES_FILENAME))
    const locks = ids.map((id) => kibitzerSidecarOwnerLockPath(join("/state", "locks"), id))
    expect(new Set(locks).size).toBe(ids.length)
  })
})

describe("kibitzer wake records", () => {
  test("#given a resident child that nudges and reports provider usage #when its wake settles #then exactly one bounded ndjson record lands beside the child transcript, carrying cursors, model, status, tool calls, duration and usage", async () => {
    const f = await fixture()
    const harness = sidecarHarness({ onWake: (settled) => f.observe.onWake(settled, f.context) })
    harness.prompt(1, "how do we roll out kubernetes changes safely")
    harness.toolCall(3)

    expect(await harness.offer([candidate(K8S)])).toEqual({ action: "seeded", wake: 1 })
    const child = harness.children[0]
    if (child === undefined) throw new Error("the seeded wake started no child")
    child.emit({ type: "message_end", message: { role: "assistant", provider: "omo-mock", model: "mock-1", content: [], usage: { input: 1_200, output: 40, cacheRead: 300, cacheWrite: 0 } } })
    expect((await child.nudge(K8S, HINT)).isError).not.toBe(true)
    child.emit({ type: "message_end", message: { role: "assistant", provider: "omo-mock", model: "mock-1", content: [], usage: { input: 1_500, output: 25, cacheRead: 300, cacheWrite: 10 } } })
    harness.clock.now += 1_500
    child.settle(completed)
    await withinMs(harness.sidecar.whenIdle(), "the wake to settle")
    await f.idle()

    const dir = kibitzerSidecarSessionDir(f.context.identityPaths.recall, SESSION_ID)
    expect(await readdir(dir)).toEqual([KIBITZER_WAKES_FILENAME])
    const [record, ...rest] = await f.wakes(SESSION_ID)
    expect(rest).toEqual([])
    expect(record).toEqual({
      version: 1,
      at: new Date(f.clock.now).toISOString(),
      sessionId: SESSION_ID,
      wake: 1,
      generation: 1,
      status: "completed",
      model: "omo-mock/mock-1",
      candidateCount: 1,
      nudged: [K8S],
      steered: 0,
      toolCalls: 1,
      durationMs: 1_500,
      slotWaitMs: 0,
      cursors: { first: 1, last: 3 },
      contextTokens: 1_800,
      usage: { input: 2_700, output: 65, cacheRead: 600, cacheWrite: 10 },
      diagnostic: false,
    })
    expect(harness.delivered).toEqual([[{ path: K8S, hint: HINT }]])
    expect(f.gates()).toEqual([])
    expect(f.warnings).toEqual([])
  })

  test("#given failure reasons carrying credentials, a stack frame and a local path #when the wakes are recorded #then the file holds one line per wake with every secret and frame redacted and every field bounded", async () => {
    const f = await fixture()
    const leaky = [
      `provider refused: Authorization: Bearer ${FAKE_SK_TOKEN}`,
      `OPENAI_API_KEY=${FAKE_SK_TOKEN} was rejected; token ${FAKE_GITHUB_TOKEN} too`,
      `Error: boom\n    at Object.<anonymous> (/Users/someone/private-project/src/child.ts:12:3)\n    at run (/Users/someone/private-project/src/run.ts:1:1)`,
      "x".repeat(5_000),
    ]
    for (const [index, reason] of leaky.entries()) {
      f.observe.onWake(outcome({
        wake: index + 1,
        status: "failed",
        cause: "child_failed",
        reason,
        model: `omo-mock/${"m".repeat(400)}`,
        nudges: Array.from({ length: 5 }, (_, item) => ({ path: `reference/${"p".repeat(1_000)}-${item}.md`, hint: HINT })),
      }), f.context)
    }
    await f.idle()

    const text = await readFile(kibitzerWakesFile(f.context.identityPaths.recall, SESSION_ID), "utf8")
    const lines = text.trimEnd().split("\n")
    expect(lines).toHaveLength(leaky.length)
    expect(containsSecretLikeMaterial(text)).toBe(false)
    for (const needle of [FAKE_SK_TOKEN, FAKE_GITHUB_TOKEN, "Bearer sk-", "OPENAI_API_KEY=sk", "/Users/someone", "private-project", "    at "]) {
      expect(text).not.toContain(needle)
    }
    const records = lines.map((line) => JSON.parse(line) as KibitzerWakeRecord)
    expect(records.map((record) => record.wake)).toEqual([1, 2, 3, 4])
    expect(records[2]?.reason).toBe("Error: boom")
    for (const [index, record] of records.entries()) {
      expect(lines[index]?.length).toBeLessThanOrEqual(KIBITZER_WAKE_RECORD_MAX_CHARS)
      expect(record.status).toBe("failed")
      expect(record.diagnostic).toBe(true)
      expect((record.reason ?? "").length).toBeLessThanOrEqual(GATE_REASON_MAX_CHARS)
      expect((record.model ?? "").length).toBeLessThanOrEqual(128)
      for (const path of record.nudged) expect(path.length).toBeLessThanOrEqual(256)
    }
    expect(f.warnings).toEqual([])
  })
})

describe("kibitzer diagnostic streak notice", () => {
  test("#given three isolated failures each followed by a normal completion #when the wakes are observed #then no omo-kibitzer:gate notice is appended while every wake is still recorded", async () => {
    const f = await fixture()
    const statuses: KibitzerWakeOutcome["status"][] = ["failed", "completed", "failed", "tool_budget_exceeded", "failed", "deadline", "failed"]
    for (const [index, status] of statuses.entries()) f.observe.onWake(outcome({ wake: index + 1, status }), f.context)
    await f.idle()

    expect(f.gates()).toEqual([])
    expect(f.entries).toEqual([])
    expect((await f.wakes(SESSION_ID)).map((record) => [record.wake, record.status, record.diagnostic])).toEqual(
      statuses.map((status, index) => [index + 1, status, status === "failed"]),
    )
    expect(f.warnings).toEqual([])
  })

  test("#given three consecutive diagnostic failures (three diagnostic) #when the third settles #then exactly one actionable gate notice is appended, a fourth failure adds nothing, and a normal completion or shutdown starts a fresh streak", async () => {
    const f = await fixture()
    expect(KIBITZER_PERSISTENT_FAILURE_THRESHOLD).toBe(3)

    f.observe.onWake(outcome({ wake: 1, status: "failed", cause: "start_failed", reason: "Kibitzer sidecar model unavailable: quick (category_unavailable)" }), f.context)
    f.observe.onWake(outcome({ wake: 2, status: "failed", generation: 2 }), f.context)
    expect(f.gates()).toEqual([])
    f.observe.onWake(outcome({ wake: 3, status: "failed", generation: 3, reason: `Authorization: Bearer ${FAKE_SK_TOKEN}` }), f.context)
    expect(f.gates()).toHaveLength(1)
    f.observe.onWake(outcome({ wake: 4, status: "failed", generation: 4 }), f.context)
    expect(f.gates()).toHaveLength(1)
    expect(f.entries[0]?.customType).toBe(GATE_ENTRY_TYPE)
    expect(f.gates()[0]).toEqual({
      version: 1,
      status: "failed",
      cause: "child_failed_upstream",
      model: "omo-mock/mock-1",
      candidateCount: 2,
      reason: "***",
      consecutiveFailures: 3,
      wake: 3,
    })

    // A normal completion ends the streak: the next three failures are a new streak with its own single notice.
    f.observe.onWake(outcome({ wake: 5, status: "completed", generation: 4 }), f.context)
    for (const wake of [6, 7]) f.observe.onWake(outcome({ wake, status: "failed", generation: 5 }), f.context)
    expect(f.gates()).toHaveLength(1)
    f.observe.onWake(outcome({ wake: 8, status: "failed", generation: 6 }), f.context)
    expect(f.gates()).toHaveLength(2)
    expect(f.gates()[1]?.wake).toBe(8)

    // Session shutdown forgets the streak; the same session id starting over is not "still failing".
    for (const wake of [9, 10]) f.observe.onWake(outcome({ wake, status: "failed", generation: 7 }), f.context)
    await f.observe.onSessionShutdown(SESSION_ID, f.context)
    for (const wake of [1, 2]) f.observe.onWake(outcome({ wake, status: "failed" }), f.context)
    expect(f.gates()).toHaveLength(2)

    // Streaks are per main session: another session's failures never add to this one.
    for (const wake of [1, 2]) f.observe.onWake(outcome({ wake, status: "failed", sessionId: "other-main-session" }), f.context)
    expect(f.gates()).toHaveLength(2)

    await f.idle()
    expect((await f.wakes(SESSION_ID)).length).toBe(12)
    expect((await f.wakes("other-main-session")).length).toBe(2)
    expect(f.warnings).toEqual([])
  })
})

describe("kibitzer sidecar retention", () => {
  test("#given aged, live and fresh sidecar directories (live sidecar retention) #when the seven-day sweep runs #then only the idle unowned directory goes, a live child's directory and an active session's directory never do, and a leftover tombstone is cleared", async () => {
    const f = await fixture()
    const recall = f.context.identityPaths.recall
    const locks = f.context.identityPaths.locks
    // Age is measured against the fixture's pinned clock, the same clock the sweep reads; deriving it
    // from wall-clock time instead makes the test pass or fail depending on the day it runs.
    const now = () => f.clock.now
    const eightDaysAgo = f.clock.now - 8 * DAY_MS
    expect(KIBITZER_SIDECAR_RETENTION_MS).toBe(7 * DAY_MS)

    const stale = await sidecarDirWithTranscript(f.context, "stale-session", eightDaysAgo)
    const active = await sidecarDirWithTranscript(f.context, "active-session", eightDaysAgo)
    const otherProcess = await sidecarDirWithTranscript(f.context, "other-process-session", eightDaysAgo)
    const fresh = await sidecarDirWithTranscript(f.context, "fresh-session", f.clock.now)
    const tombstone = join(recall, "sidecars", ".prune-leftover")
    await mkdir(tombstone, { recursive: true })
    await writeFile(join(tombstone, "child.jsonl"), "{}\n")

    // Another live process holds the owner lock of `other-process-session`; this process's sidecar owns `active-session`.
    const foreign = await createLockRecord("recall-sidecar")
    await acquireLock(kibitzerSidecarOwnerLockPath(locks, "other-process-session"), foreign)

    const first = await pruneKibitzerSidecars({ recallDir: recall, locksDir: locks, now, owned: new Set([basename(active)]) })
    expect(first.pruned).toEqual([basename(stale)])
    expect([...first.kept].sort()).toEqual([basename(active), basename(fresh), basename(otherProcess)].sort())
    expect(existsSync(stale)).toBe(false)
    expect(existsSync(tombstone)).toBe(false)
    for (const dir of [active, otherProcess, fresh]) expect(existsSync(dir)).toBe(true)

    // The owner lock alone kept `other-process-session`: once its owner lets go, the aged directory is prunable.
    expect(await releaseLock(kibitzerSidecarOwnerLockPath(locks, "other-process-session"), foreign)).toBe(true)
    const second = await pruneKibitzerSidecars({ recallDir: recall, locksDir: locks, now, owned: new Set([basename(active)]) })
    expect(second.pruned).toEqual([basename(otherProcess)])
    expect(existsSync(active)).toBe(true)

    // A sidecar coming alive takes the owner lock and sweeps the identity: its own aged directory survives that sweep.
    f.observe.own("active-session", f.context)
    await f.idle()
    expect(existsSync(kibitzerSidecarOwnerLockPath(locks, "active-session"))).toBe(true)
    expect(existsSync(active)).toBe(true)
    expect(existsSync(fresh)).toBe(true)

    // The session's own shutdown releases its directory and sweeps: the aged directory goes only now.
    await f.observe.onSessionShutdown("active-session", f.context)
    await f.idle()
    expect(existsSync(kibitzerSidecarOwnerLockPath(locks, "active-session"))).toBe(false)
    expect(existsSync(active)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
    expect((await readdir(join(recall, "sidecars"))).sort()).toEqual([basename(fresh)])
    expect(f.warnings).toEqual([])
  })

  test("#given an identity with no sidecar directory yet #when a session is owned and shut down #then the sweep is a no-op and the wake record written under shutdown is durable before shutdown resolves", async () => {
    const f = await fixture()
    f.observe.own(SESSION_ID, f.context)
    f.observe.onWake(outcome({ wake: 1, status: "cancelled", cause: "shutdown", diagnostic: false }), f.context)
    await f.observe.onSessionShutdown(SESSION_ID, f.context)

    expect((await f.wakes(SESSION_ID)).map((record) => [record.status, record.cause])).toEqual([["cancelled", "shutdown"]])
    await f.idle()
    expect(existsSync(kibitzerSidecarOwnerLockPath(f.context.identityPaths.locks, SESSION_ID))).toBe(false)
    expect(f.warnings).toEqual([])
  })
})
