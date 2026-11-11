import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { acquireLock, createLockRecord, releaseLock } from "../locks"
import { reflectionSchedulerLockPath, runFinalizationLockPath } from "../locks/domains"
import { ReflectionReservationStore } from "../reflection/reservation"
import { recordReflectionRunIdMark } from "../reflection/run-id-high-water"
import { TranscriptJournal } from "../journal/store"
import { sweepEmptyTranscriptJournals } from "../journal/sweep"
import { DEFAULT_RUNTIME_RETENTION, runRuntimeRetention, type RuntimeRetentionOptions } from "./index"
import {
  ageTree,
  cleanupRoots,
  completion,
  completionsDir,
  daysAgo,
  exitedPid,
  identity,
  iso,
  journal,
  NOW,
  now,
  readOnlyPayload,
  reflectionRun,
  reservation,
  runIdMark,
  runsDir,
  sidecar,
  writeJson,
} from "./retention.test-support"
import type { MemoryIdentityPaths } from "../identity/layout"

afterEach(cleanupRoots)

const UNREFLECTED_ON = { ...DEFAULT_RUNTIME_RETENTION, discardUnreflectedJournals: true }

function retention(paths: MemoryIdentityPaths, extra: Partial<RuntimeRetentionOptions> = {}) {
  return runRuntimeRetention({ paths, policy: UNREFLECTED_ON, now, ...extra })
}

async function tombstones(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [] as string[])).filter((name) => name.startsWith(".prune-"))
}

describe("runtime retention: reflection run directories", () => {
  test("#given a folded run idle past retention #when the pass runs #then the dir is removed and its completion kept (A01)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-5", { outcome: "merged" })
    await reflectionRun(paths, "reflection-run-9", { outcome: "no_changes", finishedAt: daysAgo(1) })
    await completion(paths, "reflection-run-5", { status: "consumed", finishedAt: daysAgo(8) })

    const report = await retention(paths)

    expect(report.runs.removed).toEqual(["reflection-run-5"])
    expect(existsSync(join(runsDir(paths), "reflection-run-5"))).toBe(false)
    expect(await tombstones(runsDir(paths))).toEqual([])
    expect(existsSync(join(completionsDir(paths), "reflection-run-5.json"))).toBe(true)
  })

  test("#given a folded run whose file was touched recently #when the pass runs #then it is kept as recent (A02)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-4", { finishedAt: daysAgo(8) })
    const dir = await reflectionRun(paths, "reflection-run-5")
    await ageTree(join(dir, "child-1.log"), daysAgo(2))
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    const report = await retention(paths)
    expect(report.runs.removed).toEqual(["reflection-run-4"])

    expect(report.runs.kept["reflection-run-5"]).toBe("recent")
    expect(existsSync(dir)).toBe(true)
  })

  test("#given a folded run whose final.json names another run #when the pass runs #then it is kept as malformed (A03)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-4", { finishedAt: daysAgo(8) })
    const dir = await reflectionRun(paths, "reflection-run-5", { finalRunId: "reflection-run-4" })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    const report = await retention(paths)
    expect(report.runs.removed).toEqual(["reflection-run-4"])

    expect(report.runs.kept["reflection-run-5"]).toBe("malformed")
    expect(existsSync(dir)).toBe(true)
  })

  test("#given failed, abandoned and quarantined runs 60 days old #when the pass runs #then all are kept as unfolded terminal (A04)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-4", { finishedAt: daysAgo(8) })
    await reflectionRun(paths, "reflection-run-1", { outcome: "failed", finishedAt: daysAgo(60) })
    await reflectionRun(paths, "reflection-run-2", { sentinel: "abandoned", finishedAt: daysAgo(60) })
    await reflectionRun(paths, "reflection-run-3", { sentinel: "quarantined", finishedAt: daysAgo(60) })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    const report = await retention(paths)
    expect(report.runs.removed).toEqual(["reflection-run-4"])

    for (const runId of ["reflection-run-1", "reflection-run-2", "reflection-run-3"]) {
      expect(report.runs.kept[runId]).toBe("unfolded-terminal")
      expect(existsSync(join(runsDir(paths), runId))).toBe(true)
    }
  })

  test("#given a run dir with a ledger and no sentinel 60 days old #when the pass runs #then it is kept for the reaper (A05)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-4", { finishedAt: daysAgo(8) })
    await reflectionRun(paths, "reflection-run-1", { sentinel: "none", finishedAt: daysAgo(60) })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    const report = await retention(paths)
    expect(report.runs.removed).toEqual(["reflection-run-4"])

    expect(report.runs.kept["reflection-run-1"]).toBe("no-terminal")
    expect(existsSync(join(runsDir(paths), "reflection-run-1"))).toBe(true)
  })

  test("#given folded runs that are the pending and the active reservation #when the pass runs #then both are kept as reserved (A06)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-2", { finishedAt: daysAgo(8) })
    await reflectionRun(paths, "reflection-run-3")
    await reflectionRun(paths, "reflection-run-4")
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    await reservation(paths, "active.lock", "reflection-run-3")
    await reservation(paths, "pending.json", "reflection-run-4")

    const report = await retention(paths)
    expect(report.runs.removed).toEqual(["reflection-run-2"])

    expect(report.runs.kept["reflection-run-3"]).toBe("reserved")
    expect(report.runs.kept["reflection-run-4"]).toBe("reserved")
  })

  test("#given the highest-numbered run and the newest finished run are both old #when the pass runs #then both are kept as anchors (A07)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-12", { finishedAt: daysAgo(20) })
    await reflectionRun(paths, "reflection-run-7", { finishedAt: daysAgo(9) })
    await reflectionRun(paths, "reflection-run-3", { finishedAt: daysAgo(30) })

    const report = await retention(paths)

    expect(report.runs.kept["reflection-run-12"]).toBe("anchor")
    expect(report.runs.kept["reflection-run-7"]).toBe("anchor")
    expect(report.runs.removed).toEqual(["reflection-run-3"])
    expect(report.highWater).toBe(12)
  })

  test("#given a folded run whose finalize lock is held live #when the pass runs #then it is kept as locked without waiting (A08)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-4", { finishedAt: daysAgo(8) })
    await reflectionRun(paths, "reflection-run-5")
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    await mkdir(paths.locks, { recursive: true })
    const lockPath = runFinalizationLockPath(paths.locks, "reflection-run-5")
    const holder = await createLockRecord("reflection-finalize", { runId: "reflection-run-5" })
    await acquireLock(lockPath, holder)
    try {
      const report = await retention(paths)
      expect(report.runs.removed).toEqual(["reflection-run-4"])
      expect(report.runs.kept["reflection-run-5"]).toBe("locked")
      expect(existsSync(join(runsDir(paths), "reflection-run-5"))).toBe(true)
    } finally {
      await releaseLock(lockPath, holder)
    }
  })

  test("#given a tombstone left by a crashed pass #when the next pass runs #then the tombstone is removed (A09)", async () => {
    const paths = await identity()
    const tombstone = join(runsDir(paths), ".prune-reflection-run-2-0f0f")
    await mkdir(tombstone, { recursive: true })
    await writeJson(join(tombstone, "final.json"), { runId: "reflection-run-2", outcome: "merged" })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    const controller = new AbortController()
    controller.abort()

    await expect(retention(paths, { signal: controller.signal })).rejects.toThrow()
    expect(existsSync(tombstone)).toBe(true)

    await retention(paths)
    expect(existsSync(tombstone)).toBe(false)
  })

  test("#given four crash tombstones and a spent budget #when the pass runs #then tombstone removal is admitted against pass_budget_ms like any removal (REVIEW-8 L1)", async () => {
    const paths = await identity()
    for (const suffix of ["a1", "b2", "c3", "d4"]) {
      const tombstone = join(runsDir(paths), `.prune-reflection-run-2-${suffix}`)
      await mkdir(tombstone, { recursive: true })
      await writeJson(join(tombstone, "final.json"), { runId: "reflection-run-2", outcome: "merged" })
    }
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    let clock = NOW

    await runRuntimeRetention({
      paths,
      policy: { ...DEFAULT_RUNTIME_RETENTION, passBudgetMs: 1_000 },
      now: () => (clock += 600),
    })

    const left = (await tombstones(runsDir(paths))).length
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThan(4)
  })

  test("#given read-only payload files in a folded run and in a crash tombstone #when the pass runs #then both are removed completely (A25)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-5", { readOnlyPayload: true })
    const tombstone = join(runsDir(paths), ".prune-reflection-run-4-abcd")
    await mkdir(tombstone, { recursive: true })
    await readOnlyPayload(tombstone)
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    const report = await retention(paths)

    expect(report.runs.removed).toEqual(["reflection-run-5"])
    expect(existsSync(join(runsDir(paths), "reflection-run-5"))).toBe(false)
    expect(existsSync(tombstone)).toBe(false)
    expect(await tombstones(runsDir(paths))).toEqual([])
  })
})

describe("runtime retention: completion records", () => {
  test("#given consumed, pending and run-backed completions #when the pass runs with a run-id mark #then only the consumed run-less one past the window is removed (A10)", async () => {
    const paths = await identity()
    await runIdMark(paths, 200)
    await completion(paths, "reflection-run-1", { status: "consumed", finishedAt: daysAgo(31) })
    await completion(paths, "reflection-run-2", { status: "pending", finishedAt: daysAgo(90) })
    await completion(paths, "reflection-run-3", { status: "consumed", finishedAt: daysAgo(31) })
    await reflectionRun(paths, "reflection-run-3", { outcome: "failed", finishedAt: daysAgo(31) })
    for (let index = 100; index < 150; index += 1) {
      await completion(paths, `reflection-run-${index}`, { status: "consumed", finishedAt: daysAgo(1) })
    }

    const report = await retention(paths)

    expect(report.completions.removed).toEqual(["reflection-run-1"])
    expect(report.completions.kept["reflection-run-2"]).toBe("pending-delivery")
    expect(report.completions.kept["reflection-run-3"]).toBe("run-present")
    expect(existsSync(join(completionsDir(paths), "reflection-run-1.json"))).toBe(false)
  })

  test("#given an old consumed completion and no run-id mark #when the pass runs #then the pass records the mark before pruning", async () => {
    const paths = await identity()
    await completion(paths, "reflection-run-1", { status: "consumed", finishedAt: daysAgo(31) })
    await completion(paths, "reflection-run-60", { status: "consumed", finishedAt: daysAgo(31) })
    for (let index = 100; index < 150; index += 1) {
      await completion(paths, `reflection-run-${index}`, { status: "consumed", finishedAt: daysAgo(1) })
    }

    const report = await retention(paths)

    const mark = JSON.parse(await readFile(join(paths.reflection, "run-id.json"), "utf8")) as { highWater: number }
    expect(mark.highWater).toBe(149)
    expect([...report.completions.removed].sort()).toEqual(["reflection-run-1", "reflection-run-60"])
  })
})

describe("runtime retention: transcript journals", () => {
  test("#given a fully-reflected journal idle past retention #when the pass runs #then only the transcript goes and the state is stamped (A11)", async () => {
    const paths = await identity()
    const dir = await journal(paths, "s-full", "fully", daysAgo(8))

    const report = await retention(paths)

    expect(report.journals.removed).toEqual(["s-full"])
    expect(existsSync(join(dir, "transcript.jsonl"))).toBe(false)
    const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8")) as Record<string, unknown>
    expect(typeof state.transcript_pruned_at).toBe("string")
    expect(state.reflected_through_message_id).toBe("a1")
    expect(state.reflected_completed_steps).toBe(1)
    expect(state.reflected_through_byte_offset).toBeUndefined()
    const sweep = await sweepEmptyTranscriptJournals({
      transcriptsDir: paths.transcripts,
      now: () => Date.now() + 60_000,
      minIdleMs: 0,
    })
    expect(sweep.removed).toEqual([])
    expect(sweep.kept["state-content"]).toBe(1)
  })

  test("#given a fully-reflected journal with a pending compaction #when the pass runs #then it is kept (A12)", async () => {
    const paths = await identity()
    await journal(paths, "s-sibling", "fully", daysAgo(8))
    const dir = await journal(paths, "s-full", "fully", daysAgo(8), { pendingCompaction: true })

    const report = await retention(paths)
    expect(report.journals.removed).toEqual(["s-sibling"])

    expect(report.journals.kept["s-full"]).toBe("pending-compaction")
    expect(existsSync(join(dir, "transcript.jsonl"))).toBe(true)
  })

  test("#given a never-reflected journal idle past the abandoned window #when the pass runs #then the whole journal goes and a reconcile rebuilds it from scratch (A13)", async () => {
    const paths = await identity()
    const dir = await journal(paths, "s-never", "never", daysAgo(15))

    const report = await retention(paths)

    expect(report.journals.removed).toEqual(["s-never"])
    expect(existsSync(dir)).toBe(false)
    const rebuilt = new TranscriptJournal({ journalDir: dir })
    const messages = [
      { kind: "user" as const, messageId: "u1", text: "first" },
      { kind: "assistant" as const, messageId: "a1", textBlocks: ["first answer"] },
    ]
    expect(await rebuilt.reconcile(messages)).toEqual({ appended: messages.length, skipped: 0 })
    const state = await rebuilt.getState()
    expect(state.reflected_through_message_id).toBeUndefined()
    expect(state.reflected_completed_steps).toBe(0)
    expect(state.steps_since_last_successful_reflection).toBe(1)
  })

  test("#given a no-steps journal with a user row idle past the abandoned window #when the pass runs #then the whole journal goes (A14)", async () => {
    const paths = await identity()
    const dir = await journal(paths, "s-nosteps", "no-steps", daysAgo(15))

    const report = await retention(paths)

    expect(report.journals.removed).toEqual(["s-nosteps"])
    expect(existsSync(dir)).toBe(false)
  })

  test("#given never-reflected journals that are recent, live or locked #when the pass runs #then all are kept with their reason (A15)", async () => {
    const paths = await identity()
    await journal(paths, "s-sibling", "fully", daysAgo(8))
    await journal(paths, "s-recent", "never", daysAgo(13))
    await journal(paths, "s-live", "never", daysAgo(15))
    const locked = await journal(paths, "s-locked", "never", daysAgo(15))
    await writeFile(join(locked, "state.lock"), `${process.pid}\n\n`)
    await ageTree(locked, daysAgo(15))

    const report = await retention(paths, { isLiveSession: (sessionId) => sessionId === "s-live" })
    expect(report.journals.removed).toEqual(["s-sibling"])

    expect(report.journals.kept).toEqual({ "s-recent": "recent", "s-live": "live", "s-locked": "locked" })
    expect(report.journals.removed).toEqual(["s-sibling"])
  })

  test("#given a partly-reflected journal idle past the abandoned window #when the pass runs #then only the transcript goes and the anchor and counts survive (A16)", async () => {
    const paths = await identity()
    const dir = await journal(paths, "s-partly", "partly", daysAgo(15))

    const report = await retention(paths)

    expect(report.journals.removed).toEqual(["s-partly"])
    expect(existsSync(join(dir, "transcript.jsonl"))).toBe(false)
    const state = JSON.parse(await readFile(join(dir, "state.json"), "utf8")) as Record<string, unknown>
    expect(state.reflected_through_message_id).toBe("a1")
    expect(state.reflected_completed_steps).toBe(1)
    expect(state.steps_since_last_successful_reflection).toBe(1)
    expect(typeof state.transcript_pruned_at).toBe("string")
    expect(state.reflected_through_byte_offset).toBeUndefined()
  })

  test("#given a partly-reflected journal younger than the abandoned window #when the pass runs #then it is kept", async () => {
    const paths = await identity()
    await journal(paths, "s-partly", "partly", daysAgo(10))

    const report = await retention(paths)

    expect(report.journals.kept["s-partly"]).toBe("recent")
  })

  test("#given a journal whose state.json does not parse #when the pass runs #then it is kept as unreadable (A19)", async () => {
    const paths = await identity()
    await journal(paths, "s-sibling", "fully", daysAgo(8))
    const dir = join(paths.transcripts, "s-broken")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "state.json"), "{not json")
    await writeFile(join(dir, "transcript.jsonl"), "{}\n")
    await ageTree(dir, daysAgo(60))

    const report = await retention(paths)
    expect(report.journals.removed).toEqual(["s-sibling"])

    expect(report.journals.kept["s-broken"]).toBe("state-unreadable")
    expect(existsSync(join(dir, "transcript.jsonl"))).toBe(true)
  })
})

describe("runtime retention: recall stores", () => {
  test("#given idle sidecars with a dead owner, an owned one and a live-locked one #when the pass runs #then only the dead-owner one goes (A20)", async () => {
    const paths = await identity()
    const dead = await sidecar(paths, "dead-owner", daysAgo(8))
    const owned = await sidecar(paths, "owned", daysAgo(8))
    const live = await sidecar(paths, "live-owner", daysAgo(8))
    await mkdir(paths.locks, { recursive: true })
    const encode = (id: string) => Buffer.from(id, "utf8").toString("base64url")
    const deadLock = join(paths.locks, `recall-sidecar.${encode("dead-owner")}.lock`)
    await writeFile(
      deadLock,
      `${JSON.stringify({ ...(await createLockRecord("recall-sidecar")), pid: exitedPid(), process_start: "unavailable" })}\n`,
    )
    const liveLock = join(paths.locks, `recall-sidecar.${encode("live-owner")}.lock`)
    const liveRecord = await createLockRecord("recall-sidecar")
    await acquireLock(liveLock, liveRecord)
    try {
      const lockFreeAtDelete: boolean[] = []
      const report = await retention(paths, {
        ownedSidecars: new Set([encode("owned")]),
        beforeTombstoneDelete: async (tombstone) => {
          if (!tombstone.includes(join("recall", "sidecars"))) return
          const probe = await createLockRecord("recall-sidecar")
          try {
            await acquireLock(deadLock, probe, { waitTimeoutMs: 0 })
            lockFreeAtDelete.push(true)
            await releaseLock(deadLock, probe)
          } catch {
            lockFreeAtDelete.push(false)
          }
        },
      })
      expect(lockFreeAtDelete).toEqual([true])
      expect(report.sidecars.removed).toEqual([encode("dead-owner")])
      expect(report.sidecars.kept).toEqual({ [encode("owned")]: "owned", [encode("live-owner")]: "locked" })
      expect(existsSync(dead)).toBe(false)
      expect(existsSync(owned)).toBe(true)
      expect(existsSync(live)).toBe(true)
    } finally {
      await releaseLock(liveLock, liveRecord)
    }
  })

  test("#given an old recall ledger for an idle and for a live session #when the pass runs #then only the idle one goes (A21)", async () => {
    const paths = await identity()
    await writeJson(join(paths.recallLedger, "idle.json"), { surfaced: [] })
    await writeJson(join(paths.recallLedger, "live.json"), { surfaced: [] })
    await ageTree(paths.recallLedger, daysAgo(31))

    const report = await retention(paths, { isLiveSession: (sessionId) => sessionId === "live" })

    expect(report.ledgers.removed).toEqual(["idle"])
    expect(existsSync(join(paths.recallLedger, "live.json"))).toBe(true)
  })

  test("#given legacy recall runs and reflection-sessions entries past retention #when the pass runs #then they go except the allocator anchor (A22)", async () => {
    const paths = await identity()
    const recallRuns = join(paths.recall, "runs")
    await writeJson(join(recallRuns, "r1", "out.json"), {})
    await ageTree(recallRuns, daysAgo(8))
    for (const runId of ["reflection-run-3", "reflection-run-9"]) {
      await writeJson(join(paths.reflectionSessions, runId, "session.json"), {})
    }
    await ageTree(paths.reflectionSessions, daysAgo(8))

    const report = await retention(paths)

    expect(report.recallRuns).toBe("removed")
    expect(existsSync(recallRuns)).toBe(false)
    expect(report.reflectionSessions.removed).toEqual(["reflection-run-3"])
    expect(report.reflectionSessions.kept["reflection-run-9"]).toBe("anchor")
    expect(existsSync(paths.reflectionSessions)).toBe(true)
    const mark = JSON.parse(await readFile(join(paths.reflection, "run-id.json"), "utf8")) as { highWater: number }
    expect(mark.highWater).toBe(9)
  })

  test("#given a legacy reflection-sessions entry holding a read-only directory #when the pass runs #then it is removed completely (H2)", async () => {
    const paths = await identity()
    const entry = join(paths.reflectionSessions, "reflection-run-3")
    await writeJson(join(entry, "nested", "payload.json"), {})
    await chmod(join(entry, "nested", "payload.json"), 0o400)
    await chmod(join(entry, "nested"), 0o500)
    await writeJson(join(paths.reflectionSessions, "reflection-run-9", "session.json"), {})
    await ageTree(paths.reflectionSessions, daysAgo(8))

    const report = await retention(paths)

    expect(report.reflectionSessions.removed).toEqual(["reflection-run-3"])
    expect(existsSync(entry)).toBe(false)
  })
})

describe("runtime retention: discard_unreflected_journals (LEAD D1: off by default, switchable on; A37)", () => {
  async function fixture() {
    const paths = await identity()
    return {
      paths,
      never: await journal(paths, "s-never", "never", daysAgo(60)),
      partly: await journal(paths, "s-partly", "partly", daysAgo(60)),
      noSteps: await journal(paths, "s-nosteps", "no-steps", daysAgo(60)),
      fully: await journal(paths, "s-full", "fully", daysAgo(8)),
    }
  }

  test("#given the shipped default policy #when 60-day never-reflected, partly-reflected and no-steps journals are swept #then all three are kept and only the J1 sibling is truncated", async () => {
    const { paths, never, partly, noSteps, fully } = await fixture()

    const report = await runRuntimeRetention({ paths, policy: DEFAULT_RUNTIME_RETENTION, now })

    expect(DEFAULT_RUNTIME_RETENTION.discardUnreflectedJournals).toBe(false)
    expect(report.journals.kept).toEqual({
      "s-never": "unreflected-retention-off",
      "s-nosteps": "unreflected-retention-off",
      "s-partly": "unreflected-retention-off",
    })
    expect(report.journals.removed).toEqual(["s-full"])
    for (const dir of [never, partly, noSteps]) expect(existsSync(join(dir, "transcript.jsonl"))).toBe(true)
    expect(existsSync(join(fully, "transcript.jsonl"))).toBe(false)
  })

  test("#given discard_unreflected_journals switched on #when the same journals are swept on a healthy identity #then the never-reflected and no-steps journals go and the partly-reflected one is truncated", async () => {
    const { paths, never, partly, noSteps, fully } = await fixture()

    const report = await runRuntimeRetention({
      paths,
      policy: { ...DEFAULT_RUNTIME_RETENTION, discardUnreflectedJournals: true },
      now,
    })

    expect(report.journals.removed).toEqual(["s-full", "s-never", "s-nosteps", "s-partly"])
    expect(existsSync(never)).toBe(false)
    expect(existsSync(noSteps)).toBe(false)
    expect(existsSync(join(partly, "transcript.jsonl"))).toBe(false)
    expect(existsSync(join(fully, "transcript.jsonl"))).toBe(false)
  })
})

describe("runtime retention: journals of an in-flight reservation (J0, A32)", () => {
  async function dreamOn(paths: MemoryIdentityPaths) {
    const journals = new Map<string, TranscriptJournal>()
    const journalFor = async (id: string) => {
      const existing = journals.get(id)
      if (existing !== undefined) return existing
      const created = new TranscriptJournal({ journalDir: join(paths.transcripts, id) })
      journals.set(id, created)
      return created
    }
    let runs = 0
    const store = new ReflectionReservationStore({
      identity: { id: "agent-test", safeSlug: "agent-test", paths },
      config: { stepCount: 1, onCompaction: true },
      getJournal: journalFor,
      createRunId: () => `reflection-run-${(runs += 1)}`,
      launcherIdentity: async () => ({ pid: process.pid, hostname: "fixture-host", processStart: "fixture" }),
    })
    const reserve = async (id: string) => {
      const snapshot = await (await journalFor(id)).captureReflectionSnapshot()
      if (snapshot === null) throw new Error(`expected a snapshot for ${id}`)
      return store.tryReserve({
        trigger: "dream",
        origin: "shutdown",
        conversationIds: [id],
        snapshots: [{ conversationId: id, snapshot }],
      })
    }
    return { store, reserve }
  }

  test("#given a dream active on X and pending on Y #when retention runs and the dream then merges #then X and Y are kept as reserved and X lands its anchor with counted steps", async () => {
    const paths = await identity()
    for (const id of ["X", "Y", "Z"]) await journal(paths, id, "never", daysAgo(15))
    const { store, reserve } = await dreamOn(paths)
    const active = await reserve("X")
    const pending = await reserve("Y")
    expect(active.status).toBe("active")
    expect(pending.status).toBe("pending")
    // The #11976 shape: a reservation stuck for days, so its capture stamp is as old as the files.
    for (const id of ["X", "Y"]) {
      const statePath = join(paths.transcripts, id, "state.json")
      const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>
      await writeFile(statePath, JSON.stringify({ ...state, last_reflection_started_at: iso(daysAgo(15)) }))
    }
    for (const id of ["X", "Y", "Z"]) await ageTree(join(paths.transcripts, id), daysAgo(15))

    const report = await retention(paths)

    expect(report.journals.kept["X"]).toBe("reserved")
    expect(report.journals.kept["Y"]).toBe("reserved")
    expect(report.journals.removed).toEqual(["Z"])
    if (active.status !== "active") throw new Error("expected an active dream")
    await store.complete(active.run.runId, "merged")
    const state = JSON.parse(await readFile(join(paths.transcripts, "X", "state.json"), "utf8")) as Record<
      string,
      unknown
    >
    expect(state.reflected_through_message_id).toBe("a1")
    expect(state.reflected_completed_steps).toBe(1)
    expect(existsSync(join(paths.transcripts, "X", "transcript.jsonl"))).toBe(true)
  })

  test("#given the scheduler lock is held by a reservation in progress #when retention runs #then every journal rule is skipped", async () => {
    const paths = await identity()
    const dir = await journal(paths, "Z", "never", daysAgo(15))
    const fully = await journal(paths, "F", "fully", daysAgo(15))
    await mkdir(paths.locks, { recursive: true })
    const holder = await createLockRecord("reflection-scheduler")
    const lockPath = reflectionSchedulerLockPath(paths.locks)
    await acquireLock(lockPath, holder)
    try {
      const report = await retention(paths)
      expect(report.skipped).toEqual(["reflection-scheduler-busy"])
      expect(report.journals.removed).toEqual([])
      expect(existsSync(dir)).toBe(true)
      expect(existsSync(join(fully, "transcript.jsonl"))).toBe(true)
    } finally {
      await releaseLock(lockPath, holder)
    }
  })
})

describe("runtime retention: unclassified journal states (L1, A30)", () => {
  async function rawJournal(
    paths: MemoryIdentityPaths,
    sessionId: string,
    state: Record<string, unknown>,
  ): Promise<string> {
    const dir = join(paths.transcripts, sessionId)
    await writeJson(join(dir, "state.json"), { schema_version: "v3_assistant_steps", ...state })
    await writeFile(
      join(dir, "transcript.jsonl"),
      `${JSON.stringify({ kind: "assistant", text: "a", captured_at: "2026-10-01T00:00:00.000Z", source_line_id: "a1:assistant", source_message_id: "a1" })}\n`,
    )
    await ageTree(dir, daysAgo(60))
    return dir
  }

  test("#given three journals in shapes no rule names and a never-reflected sibling #when the pass runs #then the three are kept as unclassified and the sibling is removed", async () => {
    const paths = await identity()
    const anchoredZero = await rawJournal(paths, "anchored-zero", {
      total_completed_steps: 1,
      reflected_completed_steps: 0,
      steps_since_last_successful_reflection: 1,
      reflected_through_message_id: "a1",
    })
    const countedNoAnchor = await rawJournal(paths, "counted-no-anchor", {
      total_completed_steps: 1,
      reflected_completed_steps: 1,
      steps_since_last_successful_reflection: 0,
    })
    const negative = await rawJournal(paths, "negative", {
      total_completed_steps: 2,
      reflected_completed_steps: -1,
      steps_since_last_successful_reflection: 3,
      reflected_through_message_id: "a1",
    })
    const sibling = await journal(paths, "sibling", "never", daysAgo(15))

    const report = await retention(paths)

    expect(report.journals.kept).toEqual({
      "anchored-zero": "unclassified",
      "counted-no-anchor": "unclassified",
      negative: "unclassified",
    })
    expect(report.journals.removed).toEqual(["sibling"])
    for (const dir of [anchoredZero, countedNoAnchor, negative])
      expect(existsSync(join(dir, "transcript.jsonl"))).toBe(true)
    expect(existsSync(sibling)).toBe(false)
  })
})

describe("runtime retention: reflection-health gate for unreflected input (N4, A27)", () => {
  async function completionWith(paths: MemoryIdentityPaths, runId: string, outcome: string, at: number): Promise<void> {
    await writeJson(join(completionsDir(paths), `${runId}.json`), {
      schemaVersion: 1,
      runId,
      identity: "agent-test",
      category: "quick",
      conversationIds: [],
      trigger: "manual",
      outcome,
      startedAt: iso(at - 60_000),
      finishedAt: iso(at),
      delivery: { status: "consumed" },
    })
  }

  const shapes: Record<
    string,
    {
      readonly open: boolean
      readonly enabled?: boolean
      readonly write: (paths: MemoryIdentityPaths) => Promise<void>
    }
  > = {
    "(i) newest failed 2 d ago, no success": {
      open: false,
      write: (paths) => completionWith(paths, "reflection-run-1", "failed", daysAgo(2)),
    },
    "(ii) newest failed 20 d ago, no success": {
      open: false,
      write: (paths) => completionWith(paths, "reflection-run-1", "failed", daysAgo(20)),
    },
    "(iii) only abandoned and quarantined run dirs": {
      open: false,
      write: async (paths) => {
        await reflectionRun(paths, "reflection-run-1", { sentinel: "abandoned", finishedAt: daysAgo(20) })
        await reflectionRun(paths, "reflection-run-2", { sentinel: "quarantined", finishedAt: daysAgo(20) })
      },
    },
    "(iv) parked, newest completion a success 30 d ago": {
      open: false,
      write: async (paths) => {
        await completionWith(paths, "reflection-run-1", "merged", daysAgo(30))
        await writeJson(join(paths.reflection, "park.json"), { version: 1, streak: 3, parkedAt: iso(daysAgo(29)) })
      },
    },
    "(v) newest merged 3 d ago after older failures": {
      open: true,
      write: async (paths) => {
        await completionWith(paths, "reflection-run-1", "failed", daysAgo(9))
        await completionWith(paths, "reflection-run-2", "timed_out", daysAgo(8))
        await completionWith(paths, "reflection-run-3", "merged", daysAgo(3))
      },
    },
    "(vi) no terminal event at all": { open: true, write: async () => undefined },
    "(viii) merged 10 d ago, quarantined today by the reaper for a 30-day-old generation": {
      open: true,
      write: async (paths) => {
        await completionWith(paths, "reflection-run-1", "merged", daysAgo(10))
        await reflectionRun(paths, "reflection-run-2", {
          sentinel: "quarantined",
          finishedAt: daysAgo(30),
          sentinelWrittenAt: daysAgo(0),
        })
      },
    },
    "(vii) reflection disabled, newest failed": {
      open: true,
      enabled: false,
      write: (paths) => completionWith(paths, "reflection-run-1", "failed", daysAgo(2)),
    },
  }

  for (const [shape, setup] of Object.entries(shapes)) {
    test(`#given ${shape} #when the pass runs with abandoned_journal_days 14 #then unreflected input is ${setup.open ? "removed" : "kept as reflection-unhealthy"}`, async () => {
      const paths = await identity()
      await setup.write(paths)
      const never = await journal(paths, "s-never", "never", daysAgo(15))
      const partly = await journal(paths, "s-partly", "partly", daysAgo(15))

      const report = await retention(paths, setup.enabled === undefined ? {} : { reflectionEnabled: setup.enabled })

      if (setup.open) {
        expect(report.journals.removed).toEqual(["s-never", "s-partly"])
        expect(existsSync(never)).toBe(false)
        expect(existsSync(join(partly, "transcript.jsonl"))).toBe(false)
        expect(report.unreflectedGate?.open).toBe(true)
      } else {
        expect(report.journals.kept).toEqual({ "s-never": "reflection-unhealthy", "s-partly": "reflection-unhealthy" })
        expect(existsSync(join(never, "transcript.jsonl"))).toBe(true)
        expect(existsSync(join(partly, "transcript.jsonl"))).toBe(true)
        expect(report.unreflectedGate?.open).toBe(false)
        expect(report.unreflectedGate?.newest?.kind).toMatch(/^(failed|abandoned|quarantined|parked)$/)
      }
    })
  }

  test("#given a closed gate #when a fully-reflected journal is past retention #then J1 still truncates it (the gate guards only unreflected input)", async () => {
    const paths = await identity()
    await completionWith(paths, "reflection-run-1", "failed", daysAgo(2))
    const fully = await journal(paths, "s-full", "fully", daysAgo(8))

    const report = await retention(paths)

    expect(report.journals.removed).toEqual(["s-full"])
    expect(existsSync(join(fully, "transcript.jsonl"))).toBe(false)
  })
})

describe("runtime retention: a refused claim rename (L3, A31)", () => {
  test("#given a folded run whose rename to a tombstone fails with EPERM #when the pass runs #then it is kept as claim-failed with no tombstone, and the next pass removes it", async () => {
    const paths = await identity()
    const dir = await reflectionRun(paths, "reflection-run-5", { readOnlyPayload: true })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    const refuse = async (from: string) => {
      if (from.endsWith("reflection-run-5"))
        throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" })
    }

    const first = await retention(paths, { beforeClaimRename: refuse })

    expect(first.runs.kept["reflection-run-5"]).toBe("claim-failed")
    expect(existsSync(dir)).toBe(true)
    expect(existsSync(join(dir, "transcript-payload.json"))).toBe(true)
    expect(await tombstones(runsDir(paths))).toEqual([])

    const second = await retention(paths)
    expect(second.runs.removed).toEqual(["reflection-run-5"])
    expect(existsSync(dir)).toBe(false)
  })

  test("#given a sidecar whose rename to a tombstone fails #when the pass runs #then it is kept as claim-failed", async () => {
    const paths = await identity()
    const dir = await sidecar(paths, "stale", daysAgo(8))
    const report = await retention(paths, {
      beforeClaimRename: async (from) => {
        if (from === dir) throw Object.assign(new Error("EPERM"), { code: "EPERM" })
      },
    })
    expect(report.sidecars.kept[Buffer.from("stale", "utf8").toString("base64url")]).toBe("claim-failed")
    expect(existsSync(dir)).toBe(true)
  })
})

describe("runtime retention: a capture racing a journal claim (N1, A35)", () => {
  async function storeFor(paths: MemoryIdentityPaths) {
    const store = new ReflectionReservationStore({
      identity: { id: "agent-test", safeSlug: "agent-test", paths },
      config: { stepCount: 1, onCompaction: true },
      getJournal: async (id) => new TranscriptJournal({ journalDir: join(paths.transcripts, id) }),
      createRunId: () => "reflection-run-1",
      launcherIdentity: async () => ({ pid: process.pid, hostname: "fixture-host", processStart: "fixture" }),
    })
    return store
  }

  test("#given the dream captures X after the guard is read but before the claim #when the pass reaches X #then X is kept recent and the dream merges intact rows (a)", async () => {
    const paths = await identity()
    await journal(paths, "X", "never", daysAgo(15))
    const store = await storeFor(paths)
    let captured: Awaited<ReturnType<TranscriptJournal["captureReflectionSnapshot"]>> = null

    const report = await retention(paths, {
      beforeJournalClaim: async (sessionId) => {
        if (sessionId === "X")
          captured = await new TranscriptJournal({
            journalDir: join(paths.transcripts, "X"),
          }).captureReflectionSnapshot()
      },
    })

    expect(captured).not.toBeNull()
    if (captured === null) throw new Error("expected the claim hook to capture a snapshot")
    expect(report.journals.kept["X"]).toBe("recent")
    const reserved = await store.tryReserve({
      trigger: "dream",
      origin: "shutdown",
      conversationIds: ["X"],
      snapshots: [{ conversationId: "X", snapshot: captured }],
    })
    if (reserved.status !== "active") throw new Error("expected an active dream")
    await store.complete(reserved.run.runId, "merged")
    const state = JSON.parse(await readFile(join(paths.transcripts, "X", "state.json"), "utf8")) as Record<
      string,
      unknown
    >
    expect(state.reflected_through_message_id).toBe("a1")
    expect(state.reflected_completed_steps).toBe(1)
  })

  test("#given the pass claims X first #when the dream then captures #then the capture is null for a removed (J2) and a truncated (J3) journal (b, c)", async () => {
    const paths = await identity()
    await journal(paths, "X", "never", daysAgo(15))
    await journal(paths, "P", "partly", daysAgo(15))

    const report = await retention(paths)

    expect(report.journals.removed).toEqual(["P", "X"])
    expect(
      await new TranscriptJournal({ journalDir: join(paths.transcripts, "X") }).captureReflectionSnapshot(),
    ).toBeNull()
    expect(
      await new TranscriptJournal({ journalDir: join(paths.transcripts, "P") }).captureReflectionSnapshot(),
    ).toBeNull()
  })

  test("#given a journal whose last capture started inside the window though its files look old #when the pass re-checks under the lock #then it is kept recent", async () => {
    const paths = await identity()
    const dir = await journal(paths, "S", "never", daysAgo(15))
    const statePath = join(dir, "state.json")
    const state = JSON.parse(await readFile(statePath, "utf8")) as Record<string, unknown>
    await writeFile(statePath, JSON.stringify({ ...state, last_reflection_started_at: iso(daysAgo(1)) }))
    await ageTree(dir, daysAgo(15))

    const report = await retention(paths)

    expect(report.journals.kept["S"]).toBe("recent")
    expect(existsSync(dir)).toBe(true)
  })
})

describe("runtime retention: pass budget and resume cursor (H4, N3, A33)", () => {
  test("#given 30 folded runs and a budget that admits 12 #when two passes run #then pass 1 persists a cursor and pass 2 resumes, finishes and deletes it", async () => {
    const paths = await identity()
    for (let index = 1; index <= 30; index += 1)
      await reflectionRun(paths, `reflection-run-${index}`, { finishedAt: daysAgo(10) })
    await reflectionRun(paths, "reflection-run-99", { finishedAt: daysAgo(1) })
    let clock = NOW
    const cursorPath = join(paths.runtime, "retention.json")

    const first = await runRuntimeRetention({
      paths,
      policy: { ...UNREFLECTED_ON, passBudgetMs: 60_000 },
      now: () => clock,
      beforeTombstoneDelete: async () => {
        clock += 5_000
      },
    })

    expect(first.runs.removed).toHaveLength(12)
    expect(first.cursor).toEqual({ store: "runs", lastName: first.runs.removed.at(-1) })
    const persisted = JSON.parse(await readFile(cursorPath, "utf8")) as Record<string, unknown>
    expect(persisted).toEqual({ version: 1, cursor: first.cursor })

    const second = await runRuntimeRetention({ paths, policy: UNREFLECTED_ON, now: () => NOW })

    expect(second.runs.removed).toHaveLength(18)
    expect(second.cursor).toBeUndefined()
    expect(existsSync(cursorPath)).toBe(false)
    const left = (await readdir(runsDir(paths))).sort()
    expect(left).toEqual(["reflection-run-99"])
  })

  test("#given an abort between items #when the pass stops #then the cursor is persisted and the pass rejects", async () => {
    const paths = await identity()
    for (let index = 1; index <= 5; index += 1)
      await reflectionRun(paths, `reflection-run-${index}`, { finishedAt: daysAgo(10) })
    await reflectionRun(paths, "reflection-run-99", { finishedAt: daysAgo(1) })
    const controller = new AbortController()
    let removed = 0

    await expect(
      runRuntimeRetention({
        paths,
        policy: UNREFLECTED_ON,
        now,
        signal: controller.signal,
        beforeTombstoneDelete: async () => {
          removed += 1
          if (removed === 2) controller.abort()
        },
      }),
    ).rejects.toThrow()

    const persisted = JSON.parse(await readFile(join(paths.runtime, "retention.json"), "utf8")) as {
      cursor: { store: string; lastName: string }
    }
    expect(persisted.cursor.store).toBe("runs")
    expect(existsSync(join(runsDir(paths), persisted.cursor.lastName))).toBe(false)
    expect((await readdir(runsDir(paths))).filter((name) => !name.startsWith(".prune-"))).toHaveLength(4)
  })
})

describe("runtime retention: a no-op visit takes no lock and writes nothing (R3, A36 core half)", () => {
  test("#given an identity whose stores hold only fresh items #when the pass visits it #then it records the visit, acquires no lock and changes no runtime mtime", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-1", { finishedAt: daysAgo(1) })
    await journal(paths, "fresh", "fully", daysAgo(1))
    await mkdir(paths.locks, { recursive: true })
    await ageTree(paths.root, daysAgo(8))
    const before = {
      runtime: (await stat(paths.runtime)).mtimeMs,
      locks: (await stat(paths.locks)).mtimeMs,
      reflection: (await stat(paths.reflection)).mtimeMs,
      transcript: (await stat(join(paths.transcripts, "fresh"))).mtimeMs,
    }

    const report = await retention(paths)

    expect(report.runs.kept["reflection-run-1"]).toBe("anchor")
    expect(report.journals.kept["fresh"]).toBe("recent")
    expect(report.highWater).toBeUndefined()
    expect(report.skipped).toEqual([])
    expect(await readdir(paths.locks)).toEqual([])
    expect(existsSync(join(paths.reflection, "run-id.json"))).toBe(false)
    expect({
      runtime: (await stat(paths.runtime)).mtimeMs,
      locks: (await stat(paths.locks)).mtimeMs,
      reflection: (await stat(paths.reflection)).mtimeMs,
      transcript: (await stat(join(paths.transcripts, "fresh"))).mtimeMs,
    }).toEqual(before)
  })
})

describe("runtime retention: a state.json behind its transcript (REVIEW-6 M1)", () => {
  const FOUR_ROWS = [
    { kind: "user" as const, messageId: "u1", text: "first" },
    { kind: "assistant" as const, messageId: "a1", textBlocks: ["first answer"] },
    { kind: "user" as const, messageId: "u2", text: "second" },
    { kind: "assistant" as const, messageId: "a2", textBlocks: ["second answer"] },
  ]

  /** Appends u2/a2 to the transcript while the platform refuses the state rename, then ages the journal. */
  async function appendBehindState(dir: string, idleSince: number): Promise<void> {
    const refusing = new TranscriptJournal({
      journalDir: dir,
      now: () => new Date(idleSince),
      renameFile: async () => {
        throw Object.assign(new Error("rename refused"), { code: "EPERM" })
      },
    })
    await expect(refusing.reconcile(FOUR_ROWS)).rejects.toThrow("rename refused")
    await ageTree(dir, idleSince)
  }

  test("#given a fully-reflected journal whose transcript gained rows after its last state write #when the default pass runs #then the transcript is kept as state-behind-transcript", async () => {
    const paths = await identity()
    const sibling = await journal(paths, "s-full", "fully", daysAgo(8))
    const dir = await journal(paths, "s-stale", "fully", daysAgo(8))
    await appendBehindState(dir, daysAgo(8))

    const report = await runRuntimeRetention({ paths, policy: DEFAULT_RUNTIME_RETENTION, now })

    expect(report.journals.removed).toEqual(["s-full"])
    expect(report.journals.kept["s-stale"]).toBe("state-behind-transcript")
    expect(await readFile(join(dir, "transcript.jsonl"), "utf8")).toContain("second answer")
    expect(existsSync(join(sibling, "transcript.jsonl"))).toBe(false)
  })

  test("#given a partly-reflected journal whose transcript gained rows after its last state write #when the pass runs with the switch on #then it is kept as state-behind-transcript", async () => {
    const paths = await identity()
    const dir = await journal(paths, "s-stale", "partly", daysAgo(15))
    // A third step lands past the partly-reflected state while the state rename is refused.
    const refusing = new TranscriptJournal({
      journalDir: dir,
      renameFile: async () => {
        throw Object.assign(new Error("rename refused"), { code: "EPERM" })
      },
    })
    await expect(
      refusing.reconcile([...FOUR_ROWS, { kind: "assistant", messageId: "a5", textBlocks: ["third answer"] }]),
    ).rejects.toThrow("rename refused")
    await ageTree(dir, daysAgo(15))

    const report = await retention(paths)

    expect(report.journals.kept["s-stale"]).toBe("state-behind-transcript")
    expect(await readFile(join(dir, "transcript.jsonl"), "utf8")).toContain("third answer")
  })

  test("#given rows land behind the state between the lock-free selection and the claim #when the pass re-checks under the lock #then the transcript is kept as state-behind-transcript", async () => {
    const paths = await identity()
    const dir = await journal(paths, "s-race", "fully", daysAgo(8))

    const report = await runRuntimeRetention({
      paths,
      policy: DEFAULT_RUNTIME_RETENTION,
      now,
      beforeJournalClaim: async (sessionId) => {
        if (sessionId === "s-race") await appendBehindState(dir, daysAgo(8))
      },
    })

    expect(report.journals.kept["s-race"]).toBe("state-behind-transcript")
    expect(await readFile(join(dir, "transcript.jsonl"), "utf8")).toContain("second answer")
  })
})

/** A signal that reads as aborted from its `limit`-th check on: an abort that lands between two classified items. */
function abortedFromCheck(limit: number): AbortSignal {
  let checks = 0
  const reason = new Error("retention aborted by the test")
  const signal = {
    get aborted() {
      checks += 1
      return checks >= limit
    },
    reason,
    throwIfAborted() {
      if (signal.aborted) throw reason
    },
  }
  return signal as unknown as AbortSignal
}

async function resumeAt(
  paths: MemoryIdentityPaths,
  cursor: { readonly store: string; readonly lastName?: string },
): Promise<void> {
  await writeJson(join(paths.runtime, "retention.json"), { version: 1, cursor })
}

describe("runtime retention: classify loops and the health gate are bounded (REVIEW-6 L)", () => {
  test("#given more unfolded runs than the time budget would cover #when the pass classifies them #then classification is not stopped by the budget and the pass finishes without a cursor", async () => {
    const paths = await identity()
    for (let index = 1; index <= 10; index += 1)
      await reflectionRun(paths, `reflection-run-${index}`, { outcome: "failed", finishedAt: daysAgo(60) })
    let clock = NOW

    const report = await runRuntimeRetention({
      paths,
      policy: { ...DEFAULT_RUNTIME_RETENTION, passBudgetMs: 1_000 },
      now: () => (clock += 400),
    })

    expect(Object.keys(report.runs.kept)).toHaveLength(10)
    expect(report.cursor).toBeUndefined()
    expect(existsSync(join(paths.runtime, "retention.json"))).toBe(false)
  })

  test("#given more unreadable completion records than the time budget would cover #when the pass classifies them #then every record is classified in one pass", async () => {
    const paths = await identity()
    for (let index = 1; index <= 10; index += 1)
      await writeJson(join(completionsDir(paths), `reflection-run-${index}.json`), {})
    let clock = NOW

    const report = await runRuntimeRetention({
      paths,
      policy: { ...DEFAULT_RUNTIME_RETENTION, passBudgetMs: 1_000 },
      now: () => (clock += 400),
    })

    expect(Object.keys(report.completions.kept)).toHaveLength(10)
    expect(report.cursor).toBeUndefined()
  })

  test("#given a pass resumed at journals #when an abort lands while the runs are classified #then the pass rejects and the persisted cursor stays at the journals resume point", async () => {
    const paths = await identity()
    for (let index = 1; index <= 10; index += 1)
      await reflectionRun(paths, `reflection-run-${index}`, { outcome: "failed", finishedAt: daysAgo(60) })
    await resumeAt(paths, { store: "journals", lastName: "s-05" })

    await expect(
      runRuntimeRetention({ paths, policy: DEFAULT_RUNTIME_RETENTION, now, signal: abortedFromCheck(4) }),
    ).rejects.toThrow("retention aborted by the test")

    const persisted = JSON.parse(await readFile(join(paths.runtime, "retention.json"), "utf8")) as { cursor: unknown }
    expect(persisted.cursor).toEqual({ store: "journals", lastName: "s-05" })
    expect(await readdir(runsDir(paths))).toHaveLength(10)
  })

  test("#given discard_unreflected_journals is off #when the pass runs on a parked identity #then the health gate is not read", async () => {
    const paths = await identity()
    await writeJson(join(paths.reflection, "park.json"), { parkedAt: iso(daysAgo(1)) })

    const off = await runRuntimeRetention({ paths, policy: DEFAULT_RUNTIME_RETENTION, now })
    const on = await retention(paths)

    expect(off.unreflectedGate).toBeUndefined()
    expect(on.unreflectedGate).toEqual({ open: false, newest: { kind: "parked", at: iso(daysAgo(1)) } })
  })
})

describe("runtime retention: a resumed or oversized pass always moves forward (REVIEW-7 L1)", () => {
  test("#given a pass resumed at {journals, s-05} #when the budget is spent while the runs are classified #then the journals resume point is kept and the next journal is processed", async () => {
    const paths = await identity()
    for (let index = 1; index <= 10; index += 1)
      await reflectionRun(paths, `reflection-run-${index}`, { outcome: "failed", finishedAt: daysAgo(60) })
    for (let index = 1; index <= 8; index += 1) await journal(paths, `s-0${index}`, "fully", daysAgo(10))
    await resumeAt(paths, { store: "journals", lastName: "s-05" })
    let clock = NOW

    const report = await runRuntimeRetention({
      paths,
      policy: { ...DEFAULT_RUNTIME_RETENTION, passBudgetMs: 1_000 },
      now: () => (clock += 400),
    })

    expect(report.cursor).toEqual({ store: "journals", lastName: "s-06" })
    expect(report.journals.removed).toEqual(["s-06"])
    for (const sessionId of ["s-01", "s-02", "s-03", "s-04", "s-05"]) {
      expect(existsSync(join(paths.transcripts, sessionId, "transcript.jsonl"))).toBe(true)
    }
  })

  test("#given 40 folded runs and a budget smaller than one pass's work #when passes repeat #then every removable run is gone within a bounded number of passes", async () => {
    const paths = await identity()
    for (let index = 1; index <= 40; index += 1)
      await reflectionRun(paths, `reflection-run-${index}`, { finishedAt: daysAgo(10) })
    let clock = NOW
    let passes = 0

    for (; passes < 40; passes += 1) {
      const report = await runRuntimeRetention({
        paths,
        policy: { ...DEFAULT_RUNTIME_RETENTION, passBudgetMs: 1_000 },
        now: () => (clock += 400),
      })
      if (report.cursor === undefined) break
    }

    expect(passes).toBeLessThan(40)
    // The newest folded run (name order breaks the finishedAt tie) and the run-id high water stay as anchors.
    expect((await readdir(runsDir(paths))).filter((name) => !name.startsWith(".prune-")).sort()).toEqual([
      "reflection-run-40",
      "reflection-run-9",
    ])
  })
})

describe("runtime retention: run-id high water under the scheduler lock (M9, A29)", () => {
  test("A29 #given a pass that recorded highWater 40 and released the lock #when a mint records 41 under the lock and a later pass records its own scan #then run-id.json keeps 41", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-1", { finishedAt: daysAgo(10) })
    await reflectionRun(paths, "reflection-run-40", { finishedAt: daysAgo(9) })
    await writeJson(join(paths.reflectionSessions, "reflection-run-2", "session.json"), {})
    await ageTree(paths.reflectionSessions, daysAgo(8))
    const mint = async (): Promise<void> => {
      const holder = await createLockRecord("reflection-scheduler", { runId: "reflection-run-41" })
      const lockPath = reflectionSchedulerLockPath(paths.locks)
      await acquireLock(lockPath, holder, { waitTimeoutMs: 0 })
      try {
        await recordReflectionRunIdMark(paths.reflection, 41)
      } finally {
        await releaseLock(lockPath, holder)
      }
    }

    const first = await retention(paths, { beforeTombstoneDelete: mint })

    expect(first.highWater).toBe(40)
    expect(first.runs.removed).toEqual(["reflection-run-1"])
    expect(first.reflectionSessions.removed).toEqual(["reflection-run-2"])
    expect(
      (JSON.parse(await readFile(join(paths.reflection, "run-id.json"), "utf8")) as { highWater: number }).highWater,
    ).toBe(41)

    await reflectionRun(paths, "reflection-run-3", { finishedAt: daysAgo(10) })
    const second = await retention(paths)

    expect(second.highWater).toBe(40)
    expect(second.runs.removed).toEqual(["reflection-run-3"])
    expect(
      (JSON.parse(await readFile(join(paths.reflection, "run-id.json"), "utf8")) as { highWater: number }).highWater,
    ).toBe(41)
  })

  test("A29 #given a mint in progress holds the scheduler lock #when retention runs #then every reflection-store rule is skipped and the pass reports reflection-scheduler-busy", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-1", { finishedAt: daysAgo(10) })
    await reflectionRun(paths, "reflection-run-5", { finishedAt: daysAgo(9) })
    for (let index = 100; index <= 150; index += 1)
      await completion(paths, `reflection-run-${index}`, { status: "consumed", finishedAt: daysAgo(31 + 150 - index) })
    await writeJson(join(paths.reflectionSessions, "reflection-run-3", "session.json"), {})
    await ageTree(paths.reflectionSessions, daysAgo(8))
    await mkdir(paths.locks, { recursive: true })
    const holder = await createLockRecord("reflection-scheduler", { runId: "reflection-run-151" })
    const lockPath = reflectionSchedulerLockPath(paths.locks)
    await acquireLock(lockPath, holder)
    try {
      const report = await retention(paths)

      expect(report.skipped).toEqual(["reflection-scheduler-busy"])
      expect(report.highWater).toBeUndefined()
      expect(report.runs.kept["reflection-run-1"]).toBe("scheduler-busy")
      expect(report.completions.kept["reflection-run-100"]).toBe("scheduler-busy")
      expect(report.reflectionSessions.kept["reflection-run-3"]).toBe("scheduler-busy")
      expect(report.runs.removed).toEqual([])
      expect(report.completions.removed).toEqual([])
      expect(report.reflectionSessions.removed).toEqual([])
      expect(existsSync(join(runsDir(paths), "reflection-run-1"))).toBe(true)
      expect(existsSync(join(completionsDir(paths), "reflection-run-100.json"))).toBe(true)
      expect(existsSync(join(paths.reflectionSessions, "reflection-run-3"))).toBe(true)
      expect(existsSync(join(paths.reflection, "run-id.json"))).toBe(false)
    } finally {
      await releaseLock(lockPath, holder)
    }
  })
})

describe("one journal that cannot be read (REVIEW-5 L1)", () => {
  test("#given a journal whose state.json cannot be read #when the pass runs #then that journal is kept as state-unreadable and the rest of the pass still runs", async () => {
    const paths = await identity()
    await journal(paths, "s-a-broken", "fully", daysAgo(10))
    await journal(paths, "s-b-full", "fully", daysAgo(10))
    const broken = join(paths.transcripts, "s-a-broken", "state.json")
    await rm(broken)
    await mkdir(broken)

    const report = await runRuntimeRetention({ paths, policy: DEFAULT_RUNTIME_RETENTION, now })

    expect(report.journals.kept["s-a-broken"]).toBe("state-unreadable")
    expect(report.journals.removed).toEqual(["s-b-full"])
    expect(report.cursor).toBeUndefined()
  })
})
