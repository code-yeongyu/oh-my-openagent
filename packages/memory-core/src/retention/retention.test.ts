import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { acquireLock, createLockRecord, releaseLock } from "../locks"
import { runFinalizationLockPath } from "../locks/domains"
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
  journal,
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

function retention(paths: MemoryIdentityPaths, extra: Partial<RuntimeRetentionOptions> = {}) {
  return runRuntimeRetention({ paths, policy: DEFAULT_RUNTIME_RETENTION, now, ...extra })
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
    const dir = await reflectionRun(paths, "reflection-run-5")
    await ageTree(join(dir, "child-1.log"), daysAgo(2))
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    const report = await retention(paths)

    expect(report.runs.kept["reflection-run-5"]).toBe("recent")
    expect(existsSync(dir)).toBe(true)
  })

  test("#given a folded run whose final.json names another run #when the pass runs #then it is kept as malformed (A03)", async () => {
    const paths = await identity()
    const dir = await reflectionRun(paths, "reflection-run-5", { finalRunId: "reflection-run-4" })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    const report = await retention(paths)

    expect(report.runs.kept["reflection-run-5"]).toBe("malformed")
    expect(existsSync(dir)).toBe(true)
  })

  test("#given failed, abandoned and quarantined runs 60 days old #when the pass runs #then all are kept as unfolded terminal (A04)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-1", { outcome: "failed", finishedAt: daysAgo(60) })
    await reflectionRun(paths, "reflection-run-2", { sentinel: "abandoned", finishedAt: daysAgo(60) })
    await reflectionRun(paths, "reflection-run-3", { sentinel: "quarantined", finishedAt: daysAgo(60) })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    const report = await retention(paths)

    for (const runId of ["reflection-run-1", "reflection-run-2", "reflection-run-3"]) {
      expect(report.runs.kept[runId]).toBe("unfolded-terminal")
      expect(existsSync(join(runsDir(paths), runId))).toBe(true)
    }
  })

  test("#given a run dir with a ledger and no sentinel 60 days old #when the pass runs #then it is kept for the reaper (A05)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-1", { sentinel: "none", finishedAt: daysAgo(60) })
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })

    const report = await retention(paths)

    expect(report.runs.kept["reflection-run-1"]).toBe("no-terminal")
    expect(existsSync(join(runsDir(paths), "reflection-run-1"))).toBe(true)
  })

  test("#given folded runs that are the pending and the active reservation #when the pass runs #then both are kept as reserved (A06)", async () => {
    const paths = await identity()
    await reflectionRun(paths, "reflection-run-3")
    await reflectionRun(paths, "reflection-run-4")
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    await reservation(paths, "active.lock", "reflection-run-3")
    await reservation(paths, "pending.json", "reflection-run-4")

    const report = await retention(paths)

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
    await reflectionRun(paths, "reflection-run-5")
    await reflectionRun(paths, "reflection-run-9", { finishedAt: daysAgo(1) })
    await mkdir(paths.locks, { recursive: true })
    const lockPath = runFinalizationLockPath(paths.locks, "reflection-run-5")
    const holder = await createLockRecord("reflection-finalize", { runId: "reflection-run-5" })
    await acquireLock(lockPath, holder)
    try {
      const report = await retention(paths)
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
    expect(report.completions.removed.sort()).toEqual(["reflection-run-1", "reflection-run-60"])
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
    const sweep = await sweepEmptyTranscriptJournals({ transcriptsDir: paths.transcripts, now, minIdleMs: 0 })
    expect(sweep.removed).toEqual([])
    expect(sweep.kept["state-content"]).toBe(1)
  })

  test("#given a fully-reflected journal with a pending compaction #when the pass runs #then it is kept (A12)", async () => {
    const paths = await identity()
    const dir = await journal(paths, "s-full", "fully", daysAgo(8), { pendingCompaction: true })

    const report = await retention(paths)

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
    await journal(paths, "s-recent", "never", daysAgo(13))
    await journal(paths, "s-live", "never", daysAgo(15))
    const locked = await journal(paths, "s-locked", "never", daysAgo(15))
    await writeFile(join(locked, "state.lock"), `${process.pid}\n\n`)
    await ageTree(locked, daysAgo(15))

    const report = await retention(paths, { isLiveSession: (sessionId) => sessionId === "s-live" })

    expect(report.journals.kept).toEqual({ "s-recent": "recent", "s-live": "live", "s-locked": "locked" })
    expect(report.journals.removed).toEqual([])
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
  })

  test("#given a partly-reflected journal younger than the abandoned window #when the pass runs #then it is kept", async () => {
    const paths = await identity()
    await journal(paths, "s-partly", "partly", daysAgo(10))

    const report = await retention(paths)

    expect(report.journals.kept["s-partly"]).toBe("recent")
  })

  test("#given a journal whose state.json does not parse #when the pass runs #then it is kept as unreadable (A19)", async () => {
    const paths = await identity()
    const dir = join(paths.transcripts, "s-broken")
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, "state.json"), "{not json")
    await writeFile(join(dir, "transcript.jsonl"), "{}\n")
    await ageTree(dir, daysAgo(60))

    const report = await retention(paths)

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
    await writeFile(deadLock, `${JSON.stringify({ ...(await createLockRecord("recall-sidecar")), pid: exitedPid(), process_start: "unavailable" })}\n`)
    const liveLock = join(paths.locks, `recall-sidecar.${encode("live-owner")}.lock`)
    const liveRecord = await createLockRecord("recall-sidecar")
    await acquireLock(liveLock, liveRecord)
    try {
      const report = await retention(paths, { ownedSidecars: new Set([encode("owned")]) })
      expect(report.sidecars.removed).toEqual([encode("dead-owner")])
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
