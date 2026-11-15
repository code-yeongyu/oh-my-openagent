import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { withLock } from "../locks/acquire"
import { runFinalizationLockPath } from "../locks/domains"
import { createLockRecord } from "../locks/lock-record"
import { readMemoryReceipts } from "../receipts"
import { ReflectionReservationStore } from "./reservation"
import { TranscriptJournal } from "../journal"
import type { ProcessLiveness } from "../locks/process-identity"
import { reclaimDeadOwnerLocks, runStaleLockReaper, type StaleLockProbe } from "./stale-lock-reaper"
import {
  HOST,
  NOW,
  RUN,
  THIS_HOST,
  activeLock,
  age,
  cleanupReaperFixtures,
  killedChild,
  pendingRun,
  readJson,
  reaperIdentity,
  runDir,
  treeHash,
  validLedger,
  writeJson,
} from "./stale-lock-reaper.test-support"

afterEach(() => cleanupReaperFixtures())

const PAYLOAD = ["reflection-persona.md", "reflection-task.md", "transcript-payload.json"] as const

function probe(pids: Record<number, ProcessLiveness> = {}): StaleLockProbe {
  return {
    hostname: () => HOST,
    now: () => NOW,
    getPidLiveness: (pid) => pids[pid] ?? "dead",
    getProcessStartIdentity: async () => null,
  }
}

async function receiptEvents(runtimeDir: string): Promise<Array<{ runId: string; event: string; reason?: string }>> {
  return (await readMemoryReceipts(runtimeDir, {})).receipts.flatMap((receipt) =>
    receipt.kind === "facts"
      ? []
      : [
          {
            runId: receipt.runId,
            event: receipt.event,
            ...(receipt.reason === undefined ? {} : { reason: receipt.reason }),
          },
        ],
  )
}

function readOnlyPayload(dir: string): void {
  mkdirSync(dir, { recursive: true })
  for (const name of PAYLOAD) {
    writeFileSync(join(dir, name), "payload")
    chmodSync(join(dir, name), 0o400)
  }
}

describe("stale reflection-lock reaper, minimal settle from the CLI (#11976)", () => {
  test("#given case A: the launcher was SIGKILLed before any run dir existed #when the reaper runs #then the lock is released with abandoned.json(launch_interrupted) and a receipt", async () => {
    // given
    const paths = reaperIdentity()
    const launcher = await killedChild()
    activeLock(paths, { launcherPid: launcher.pid, launcherHostname: THIS_HOST, launcherProcessStart: launcher.start })

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: { now: () => NOW } })

    // then
    expect(report.decision).toMatchObject({ kind: "reap", action: "launch-interrupted", runId: RUN })
    expect(report.action).toBe("reaped")
    expect(report.after).toEqual({ state: "none" })
    expect(readJson(join(runDir(paths, RUN), "abandoned.json"))).toMatchObject({
      version: 1,
      runId: RUN,
      reason: "launch_interrupted",
      kind: "reflection",
      trigger: "manual",
    })
    expect(await receiptEvents(paths.runtime)).toEqual([
      { runId: RUN, event: "abandoned", reason: "launch_interrupted" },
    ])
  })

  test("#given case A still inside the launch window #when the reaper runs #then the lock is kept", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths, { reservedAt: new Date(NOW - 20_000).toISOString() })

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.decision.kind).toBe("stuck")
    expect(existsSync(join(paths.reflection, "active.lock"))).toBe(true)
  })

  test("#given case B: a valid ledger whose supervisor and child are dead and no outcome, and a queued pending run #when the CLI reaper runs #then abandoned.json(processes_dead), a receipt, the lock released and pending.json left byte-identical (C02)", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    pendingRun(paths)
    const pendingBefore = readFileSync(join(paths.reflection, "pending.json"))
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN))

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.decision).toMatchObject({ kind: "reap", action: "processes-dead" })
    expect(report.pendingKept).toBe("reflection-run-65")
    expect(readJson(join(runDir(paths, RUN), "abandoned.json"))).toMatchObject({
      runId: RUN,
      reason: "processes_dead",
      generation: validLedger(RUN).startedAt,
    })
    expect(readJson(join(runDir(paths, RUN), "terminal-claim.json"))).toMatchObject({ kind: "abandon", runId: RUN })
    expect(await receiptEvents(paths.runtime)).toEqual([{ runId: RUN, event: "abandoned", reason: "processes_dead" }])
    expect(existsSync(join(paths.reflection, "active.lock"))).toBe(false)
    expect(readFileSync(join(paths.reflection, "pending.json"))).toEqual(pendingBefore)
  })

  test("#given an automatic run released by the CLI #when it is released #then its conversations get the failure backoff a failed completion applies", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths, { request: { trigger: "step-count", conversationIds: ["conversation-a"], snapshots: [] } })
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN))
    const journal = new TranscriptJournal({ journalDir: join(paths.transcripts, "conversation-a") })
    await journal.reconcile([{ kind: "assistant", messageId: "assistant-1", textBlocks: ["hello"] }])

    // when
    await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect((await journal.getState()).consecutive_failures).toBe(1)
  })

  test("#given a lone pending run the CLI left behind #when the next session promotes it #then it becomes active under that session's pid and pending.json is gone (C25)", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    pendingRun(paths)
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN))
    await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })
    const journal = new TranscriptJournal({ journalDir: join(paths.transcripts, "conversation-a") })
    const store = new ReflectionReservationStore({
      identity: { id: "agent-a", safeSlug: "agent-a", paths },
      config: {},
      getJournal: async () => journal,
      launcherIdentity: async () => ({ pid: 777, hostname: HOST, processStart: null }),
    })

    // when
    const promoted = await store.promotePending()

    // then
    expect(promoted).toMatchObject({ runId: "reflection-run-65", launcherPid: 777 })
    expect(await store.readState()).toEqual({
      active: expect.objectContaining({ runId: "reflection-run-65", launcherPid: 777 }),
    })
  })

  test("#given a lone pending step-count run whose journal no longer triggers it #when the next session promotes #then it is dropped as completeTransition would (C25)", async () => {
    // given
    const paths = reaperIdentity()
    writeJson(join(paths.reflection, "pending.json"), {
      runId: "reflection-run-65",
      request: { trigger: "step-count", conversationIds: ["conversation-a"], snapshots: [] },
    })
    const journal = new TranscriptJournal({ journalDir: join(paths.transcripts, "conversation-a") })
    const store = new ReflectionReservationStore({
      identity: { id: "agent-a", safeSlug: "agent-a", paths },
      config: { stepCount: 5 },
      getJournal: async () => journal,
    })

    // when
    const promoted = await store.promotePending()

    // then
    expect(promoted).toBeUndefined()
    expect(await store.readState()).toEqual({})
  })

  test.each([
    ["parked within the probe interval", 60_000, undefined],
    ["parked past the probe interval", 3 * 24 * 60 * 60_000, "reflection-run-65"],
  ] as const)(
    "#given a lone automatic pending run on an identity %s #when the next session promotes #then the park gate decides it exactly as tryReserve would (C25)",
    async (_name, parkedFor, expected) => {
      // given
      const paths = reaperIdentity()
      writeJson(join(paths.reflection, "pending.json"), {
        runId: "reflection-run-65",
        request: { trigger: "step-count", conversationIds: ["conversation-a"], snapshots: [] },
      })
      writeJson(join(paths.reflection, "park.json"), {
        version: 1,
        streak: 5,
        parkedAt: new Date(NOW - parkedFor).toISOString(),
      })
      const journal = new TranscriptJournal({ journalDir: join(paths.transcripts, "conversation-a") })
      await journal.reconcile([{ kind: "assistant", messageId: "assistant-1", textBlocks: ["hello"] }])
      const store = new ReflectionReservationStore({
        identity: { id: "agent-a", safeSlug: "agent-a", paths },
        config: { stepCount: 1 },
        getJournal: async () => journal,
        now: () => new Date(NOW),
      })

      // when
      const promoted = await store.promotePending()

      // then
      expect(promoted?.runId).toBe(expected)
      expect((await store.readState()).active?.runId).toBe(expected)
      expect(existsSync(join(paths.reflection, "pending.json"))).toBe(false)
    },
  )

  test("#given a lone pending run #when a new request is reserved before any promotion #then reserveTransition is unchanged: the new request is active and the old pending stays queued (C25)", async () => {
    // given
    const paths = reaperIdentity()
    pendingRun(paths)
    const journal = new TranscriptJournal({ journalDir: join(paths.transcripts, "conversation-a") })
    const store = new ReflectionReservationStore({
      identity: { id: "agent-a", safeSlug: "agent-a", paths },
      config: {},
      getJournal: async () => journal,
      createRunId: () => "reflection-run-66",
    })

    // when
    const result = await store.tryReserve({ trigger: "manual", conversationIds: ["conversation-b"], snapshots: [] })

    // then
    expect(result).toMatchObject({ status: "active", run: { runId: "reflection-run-66" } })
    expect((await store.readState()).pending?.runId).toBe("reflection-run-65")
  })

  test("#given a session holds the run's finalize lock #when the CLI reaper races it #then it keeps the run and writes nothing (C26 i)", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN))
    const before = treeHash(paths.reflection)
    let report: Awaited<ReturnType<typeof runStaleLockReaper>> | undefined

    // when
    await withLock(
      runFinalizationLockPath(paths.locks, RUN),
      await createLockRecord("reflection-finalize", { runId: RUN }),
      async () => {
        report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })
      },
    )

    // then
    expect(report).toMatchObject({ action: "kept", keptReason: "a session is finalizing it" })
    expect(treeHash(paths.reflection)).toBe(before)
  })

  test("#given the run is already publishing its outcome #when the CLI reaper settles it #then it stops before any claim and releases nothing (C26 iii)", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN, { attempt: 1 }))
    writeJson(join(runDir(paths, RUN), "publishing.json"), {
      version: 1,
      runId: RUN,
      attempt: 1,
      finishedAt: new Date(NOW).toISOString(),
    })

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report).toMatchObject({ action: "kept", keptReason: "the run is already publishing its outcome" })
    expect(existsSync(join(runDir(paths, RUN), "terminal-claim.json"))).toBe(false)
    expect(existsSync(join(runDir(paths, RUN), "abandoned.json"))).toBe(false)
    expect(existsSync(join(paths.reflection, "active.lock"))).toBe(true)
  })

  test("#given a live process already claimed the run for publication #when the CLI reaper settles it #then it keeps the run (C26)", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN))
    writeJson(join(runDir(paths, RUN), "terminal-claim.json"), {
      version: 1,
      kind: "publish",
      runId: RUN,
      attempt: 1,
      claimantPid: 9191,
    })

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe({ 9191: "alive" }) })

    // then
    expect(report).toMatchObject({ action: "kept", keptReason: "another process claimed the run" })
    expect(existsSync(join(runDir(paths, RUN), "abandoned.json"))).toBe(false)
  })

  test("#given an earlier settle wrote abandoned.json and stopped before releasing #when the reaper runs again #then it only releases the lock (C29, REVIEW-2 N2)", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    pendingRun(paths)
    const pendingBefore = readFileSync(join(paths.reflection, "pending.json"))
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN))
    writeJson(join(runDir(paths, RUN), "abandoned.json"), {
      version: 1,
      runId: RUN,
      reason: "processes_dead",
      generation: validLedger(RUN).startedAt,
    })
    const sentinel = readFileSync(join(runDir(paths, RUN), "abandoned.json"))

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report).toMatchObject({
      decision: { kind: "reap", action: "release-settled" },
      action: "reaped",
      pendingKept: "reflection-run-65",
    })
    expect(existsSync(join(paths.reflection, "active.lock"))).toBe(false)
    expect(readFileSync(join(runDir(paths, RUN), "abandoned.json"))).toEqual(sentinel)
    expect(readFileSync(join(paths.reflection, "pending.json"))).toEqual(pendingBefore)
    expect(await receiptEvents(paths.runtime)).toEqual([])
  })

  test("#given the active run finished merged under a dead launcher #when the CLI reaper runs #then it keeps the lock for a session to settle", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN))
    writeJson(join(runDir(paths, RUN), "final.json"), {
      version: 1,
      runId: RUN,
      outcome: "merged",
      finishedAt: new Date(NOW).toISOString(),
    })

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.decision).toMatchObject({ kind: "stuck" })
    expect(existsSync(join(paths.reflection, "active.lock"))).toBe(true)
  })

  test("#given case C (#11920): a ledger whose deadline does not add up and a recorded pid with no start that is dead #when the reaper runs #then the run is quarantined as ledger_unreadable and the lock released", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    const { processStart: _p, childPid: _c, ...ledger } = validLedger(RUN)
    writeJson(join(runDir(paths, RUN), "ledger.json"), { ...ledger, deadlineAt: 1 })

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.decision).toMatchObject({ kind: "reap", action: "ledger-unreadable" })
    expect(readJson(join(runDir(paths, RUN), "quarantined.json"))).toMatchObject({
      runId: RUN,
      reason: "ledger_unreadable",
    })
    expect(existsSync(join(runDir(paths, RUN), "reservation.quarantined.json"))).toBe(true)
    expect(await receiptEvents(paths.runtime)).toEqual([
      { runId: RUN, event: "quarantined", reason: "ledger_unreadable" },
    ])
    expect(existsSync(join(paths.reflection, "active.lock"))).toBe(false)
  })

  test("#given case C with the recorded pid ALIVE and no start #when the reaper runs #then it is kept and reported", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    const { childPid: _c, ...ledger } = validLedger(RUN)
    writeJson(join(runDir(paths, RUN), "ledger.json"), { ...ledger, deadlineAt: 1 })

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe({ 4201: "alive" }) })

    // then
    expect(report.decision.kind).toBe("stuck")
    expect(report.action).toBe("kept")
    expect(existsSync(join(runDir(paths, RUN), "quarantined.json"))).toBe(false)
    expect(existsSync(join(paths.reflection, "active.lock"))).toBe(true)
  })

  test("#given case C for a NON-active run dir (unreadable ledger, dead pids, no active.lock) #when the reaper runs #then quarantined.json is written and a receipt names the reason", async () => {
    // given
    const paths = reaperIdentity()
    writeJson(join(runDir(paths, "reflection-run-50"), "ledger.json"), "{ torn")

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.stranded).toEqual([
      {
        runId: "reflection-run-50",
        decision: expect.objectContaining({ kind: "reap", action: "ledger-unreadable" }),
        applied: true,
      },
    ])
    expect(readJson(join(runDir(paths, "reflection-run-50"), "quarantined.json"))).toMatchObject({
      reason: "ledger_unreadable",
    })
    expect(await receiptEvents(paths.runtime)).toEqual([
      { runId: "reflection-run-50", event: "quarantined", reason: "ledger_unreadable" },
    ])
  })

  test("#given case D: the launcher hostname is another host #when the reaper runs #then nothing is touched and the reason names the host", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths, { launcherHostname: "other-host" })
    const before = treeHash(paths.root)

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.decision).toMatchObject({ kind: "stuck", reason: expect.stringContaining("other-host") })
    expect(treeHash(paths.root)).toBe(before)
  })

  test("#given case E: active.lock truncated to half a JSON object and no live run #when the reaper runs #then it is moved aside byte-identical with a lock_torn receipt", async () => {
    // given
    const paths = reaperIdentity()
    const torn = JSON.stringify({
      runId: RUN,
      launcherPid: 4301,
      launcherHostname: HOST,
      request: { trigger: "manual" },
    }).slice(0, 90)
    writeJson(join(paths.reflection, "active.lock"), torn)
    age(join(paths.reflection, "active.lock"), 2 * 60 * 60_000)
    pendingRun(paths)
    const pendingBefore = readFileSync(join(paths.reflection, "pending.json"))

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.decision).toMatchObject({ kind: "reap", action: "lock-torn" })
    expect(existsSync(join(paths.reflection, "active.lock"))).toBe(false)
    const aside = readdirSync(paths.reflection).filter((name) => name.startsWith("active.lock.torn-"))
    expect(aside).toHaveLength(1)
    expect(readFileSync(join(paths.reflection, aside[0] ?? ""), "utf8")).toBe(torn)
    expect((await receiptEvents(paths.runtime)).map((receipt) => receipt.reason)).toEqual(["lock_torn"])
    expect(report.after).toEqual({ state: "none" })
    expect(readJson(join(paths.reflection, "run-id.json")).highWater).toBe(65)
    expect(readFileSync(join(paths.reflection, "pending.json"))).toEqual(pendingBefore)
  })

  test("#given case E cut inside the launcher hostname, after the launcher pid #when the reaper runs #then the torn lock is kept because its host is unknown", async () => {
    // given
    const paths = reaperIdentity()
    const torn = JSON.stringify({
      runId: RUN,
      launcherPid: 4301,
      launcherHostname: HOST,
      request: { trigger: "manual" },
    }).slice(0, 70)
    writeJson(join(paths.reflection, "active.lock"), torn)
    age(join(paths.reflection, "active.lock"), 2 * 60 * 60_000)
    const before = treeHash(paths.root)

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.decision).toEqual({
      kind: "stuck",
      runId: "unknown",
      reason: "active.lock is not valid JSON and its launcher host is unknown",
    })
    expect(report.action).toBe("kept")
    expect(readFileSync(join(paths.reflection, "active.lock"), "utf8")).toBe(torn)
    expect(treeHash(paths.root)).toBe(before)
  })

  test("#given a dead launcher whose detached supervisor has not recorded its pid yet, inside the hard deadline #when the reaper runs #then the run and its reservation are kept", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    const hardDeadlineAt = NOW + 30 * 60_000
    writeJson(
      join(runDir(paths, RUN), "ledger.json"),
      validLedger(RUN, {
        launching: true,
        pid: undefined,
        childPid: undefined,
        hardDeadlineAt,
        deadlineAt: hardDeadlineAt + 100,
      }),
    )
    const before = treeHash(paths.root)

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.decision).toEqual({
      kind: "stuck",
      runId: RUN,
      reason: "its supervisor is still launching and its hard deadline has not passed",
    })
    expect(report.action).toBe("kept")
    expect(existsSync(join(runDir(paths, RUN), "abandoned.json"))).toBe(false)
    expect(readJson(join(paths.reflection, "active.lock")).runId).toBe(RUN)
    expect(treeHash(paths.root)).toBe(before)
  })

  test("#given case E with a run dir whose supervisor is alive #when the reaper runs #then the torn lock is kept and the reason says a live run exists", async () => {
    // given
    const paths = reaperIdentity()
    writeJson(join(paths.reflection, "active.lock"), '{"runId":')
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN))
    age(join(paths.reflection, "active.lock"), 2 * 60 * 60_000)
    age(runDir(paths, RUN), 2 * 60 * 60_000)

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe({ 4201: "alive" }) })

    // then
    expect(report.decision).toMatchObject({ kind: "stuck", reason: expect.stringContaining("live") })
    expect(existsSync(join(paths.reflection, "active.lock"))).toBe(true)
  })

  test("#given a dead holder with a recorded outcome #when the CLI reaper runs #then it is reported for a session to finalize and not settled", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    writeJson(join(runDir(paths, RUN), "outcome.json"), {
      version: 1,
      runId: RUN,
      attempt: 1,
      finishedAt: new Date(NOW).toISOString(),
      childExit: { code: 0, signal: null },
      timedOut: false,
    })
    const before = treeHash(paths.root)

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.decision).toEqual({ kind: "finalize", runId: RUN })
    expect(report.action).toBe("kept")
    expect(treeHash(paths.root)).toBe(before)
  })

  test("#given a live launcher #when the reaper runs #then nothing is done", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    const before = treeHash(paths.root)

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe({ 11096: "alive" }) })

    // then
    expect(report.decision).toEqual({ kind: "none" })
    expect(report.action).toBe("none")
    expect(treeHash(paths.root)).toBe(before)
  })

  test("#given stranded dirs: prelaunch.json only 20 min old, a bare dir 2 min old, a bare dir 20 min old, a prelaunch.json naming another run #when the reaper runs #then the first and third are quarantined as stranded_no_ledger at their own mtime and the rest are kept (C11, C24)", async () => {
    // given
    const paths = reaperIdentity()
    writeJson(join(runDir(paths, "reflection-run-10"), "prelaunch.json"), {
      version: 1,
      runId: "reflection-run-10",
      worktreeDir: "/x",
      worktreeBranch: "b",
    })
    age(join(runDir(paths, "reflection-run-10"), "prelaunch.json"), 20 * 60_000)
    mkdirSync(runDir(paths, "reflection-run-11"), { recursive: true })
    age(runDir(paths, "reflection-run-11"), 2 * 60_000)
    mkdirSync(runDir(paths, "reflection-run-12"), { recursive: true })
    age(runDir(paths, "reflection-run-12"), 20 * 60_000)
    writeJson(join(runDir(paths, "reflection-run-13"), "prelaunch.json"), {
      version: 1,
      runId: "reflection-run-9",
      worktreeDir: "/x",
      worktreeBranch: "b",
    })
    age(join(runDir(paths, "reflection-run-13"), "prelaunch.json"), 20 * 60_000)

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(report.stranded.map((entry) => [entry.runId, entry.applied])).toEqual([
      ["reflection-run-10", true],
      ["reflection-run-11", false],
      ["reflection-run-12", true],
      ["reflection-run-13", false],
    ])
    expect(readJson(join(runDir(paths, "reflection-run-10"), "quarantined.json"))).toMatchObject({
      reason: "stranded_no_ledger",
      kind: "reflection",
      trigger: "unknown",
      generation: new Date(NOW - 20 * 60_000).toISOString(),
    })
    expect(existsSync(join(runDir(paths, "reflection-run-11"), "quarantined.json"))).toBe(false)
    expect(readJson(join(runDir(paths, "reflection-run-12"), "quarantined.json"))).toMatchObject({
      reason: "stranded_no_ledger",
      generation: new Date(NOW - 20 * 60_000).toISOString(),
    })
    expect(existsSync(join(runDir(paths, "reflection-run-13"), "quarantined.json"))).toBe(false)
    expect(report.stranded[3]?.decision).toEqual({ kind: "keep", reason: "its prelaunch.json names another run" })
    expect((await receiptEvents(paths.runtime)).map((entry) => [entry.runId, entry.reason]).sort()).toEqual([
      ["reflection-run-10", "stranded_no_ledger"],
      ["reflection-run-12", "stranded_no_ledger"],
    ])
  })

  test("#given case A, case C and case E on three identities #when the reaper runs as a dry run #then it reports each decision and changes nothing", async () => {
    // given
    const a = reaperIdentity("agent-a")
    activeLock(a)
    const c = reaperIdentity("agent-c")
    activeLock(c)
    writeJson(join(runDir(c, RUN), "ledger.json"), "{ torn")
    const e = reaperIdentity("agent-e")
    writeJson(join(e.reflection, "active.lock"), '{"runId":')
    age(join(e.reflection, "active.lock"), 2 * 60 * 60_000)
    const before = [treeHash(a.root), treeHash(c.root), treeHash(e.root)]

    // when
    const reports = await Promise.all(
      [a, c, e].map((paths) => runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe(), dryRun: true })),
    )

    // then
    expect(
      reports.map((report) => [
        report.decision.kind === "reap" ? report.decision.action : report.decision.kind,
        report.action,
      ]),
    ).toEqual([
      ["launch-interrupted", "would-reap"],
      ["ledger-unreadable", "would-reap"],
      ["lock-torn", "would-reap"],
    ])
    expect([treeHash(a.root), treeHash(c.root), treeHash(e.root)]).toEqual(before)
  })

  test("#given a case B run dir and stranded dirs whose payload files are read-only, and a tombstone holding read-only files #when the reaper runs #then sentinels are written beside them and the tombstone is removed", async () => {
    // given
    const paths = reaperIdentity()
    activeLock(paths)
    writeJson(join(runDir(paths, RUN), "ledger.json"), validLedger(RUN))
    readOnlyPayload(runDir(paths, RUN))
    readOnlyPayload(runDir(paths, "reflection-run-12"))
    age(runDir(paths, "reflection-run-12"), 20 * 60_000)
    const tombstone = join(paths.reflection, "runs", ".prune-reflection-run-3-0b1c")
    readOnlyPayload(tombstone)
    readOnlyPayload(join(tombstone, "nested"))

    // when
    const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: probe() })

    // then
    expect(readJson(join(runDir(paths, RUN), "abandoned.json"))).toMatchObject({ reason: "processes_dead" })
    expect(readJson(join(runDir(paths, "reflection-run-12"), "quarantined.json"))).toMatchObject({
      reason: "stranded_no_ledger",
    })
    expect(readFileSync(join(runDir(paths, RUN), "reflection-task.md"), "utf8")).toBe("payload")
    expect(report.tombstones).toEqual([{ name: ".prune-reflection-run-3-0b1c", removed: true }])
    expect(existsSync(tombstone)).toBe(false)
  })
})

describe("dead-owner runtime locks (#11976, 4.5)", () => {
  test("#given a sidecar owner lock and a facts finalize lock with dead owners and a live notice lock #when reclaimed #then the first two go and the third is kept", async () => {
    // given
    const paths = reaperIdentity()
    mkdirSync(paths.locks, { recursive: true })
    const dead = await killedChild()
    const deadOwner = {
      ...(await createLockRecord("recall-sidecar")),
      pid: dead.pid,
      process_start: dead.start ?? "unreadable-start",
    }
    writeJson(join(paths.locks, "recall-sidecar.c2Vzc2lvbg.lock"), deadOwner)
    writeJson(join(paths.locks, "finalize-facts-1.lock"), { ...deadOwner, purpose: "facts-finalize" })
    writeJson(join(paths.locks, "notice.lock"), await createLockRecord("notice"))

    // when
    const result = await reclaimDeadOwnerLocks(paths.locks)

    // then
    expect([...result.reclaimed].sort()).toEqual(["finalize-facts-1.lock", "recall-sidecar.c2Vzc2lvbg.lock"])
    expect(result.kept.map((entry) => entry.name)).toEqual(["notice.lock"])
    expect(existsSync(join(paths.locks, "notice.lock"))).toBe(true)
  })
})

describe("win32: the reaper with real process liveness and start identities (#11976 Bearmancer report, C16)", () => {
  test.skipIf(process.platform !== "win32")(
    "#given case A whose launcher was killed and recorded its real start identity #when the reaper runs #then the lock is released",
    async () => {
      // given
      const paths = reaperIdentity()
      const launcher = await killedChild()
      activeLock(paths, {
        launcherPid: launcher.pid,
        launcherHostname: THIS_HOST,
        launcherProcessStart: launcher.start,
      })

      // when
      const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: { now: () => NOW } })

      // then
      expect(report.decision).toMatchObject({ kind: "reap", action: "launch-interrupted" })
      expect(report.after).toEqual({ state: "none" })
    },
  )

  test.skipIf(process.platform !== "win32")(
    "#given case B whose supervisor and child were killed with real start identities #when the reaper runs #then the run is abandoned and the lock released",
    async () => {
      // given
      const paths = reaperIdentity()
      const [launcher, supervisor, child] = [await killedChild(), await killedChild(), await killedChild()]
      activeLock(paths, {
        launcherPid: launcher.pid,
        launcherHostname: THIS_HOST,
        launcherProcessStart: launcher.start,
      })
      writeJson(
        join(runDir(paths, RUN), "ledger.json"),
        validLedger(RUN, {
          pid: supervisor.pid,
          processStart: supervisor.start,
          childPid: child.pid,
          childProcessStart: child.start,
        }),
      )

      // when
      const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: { now: () => NOW } })

      // then
      expect(report.decision).toMatchObject({ kind: "reap", action: "processes-dead" })
      expect(report.after).toEqual({ state: "none" })
    },
  )

  test.skipIf(process.platform !== "win32")(
    "#given case E with a run dir whose recorded supervisor was killed #when the reaper runs #then the torn lock is moved aside",
    async () => {
      // given
      const paths = reaperIdentity()
      const supervisor = await killedChild()
      writeJson(join(paths.reflection, "active.lock"), '{"runId":')
      writeJson(
        join(runDir(paths, RUN), "ledger.json"),
        validLedger(RUN, { pid: supervisor.pid, processStart: supervisor.start, childPid: undefined }),
      )
      age(join(paths.reflection, "active.lock"), 2 * 60 * 60_000)
      age(runDir(paths, RUN), 2 * 60 * 60_000)

      // when
      const report = await runStaleLockReaper({ runtimeDir: paths.runtime, probe: { now: () => NOW } })

      // then
      expect(report.decision).toMatchObject({ kind: "reap", action: "lock-torn" })
      expect(existsSync(join(paths.reflection, "active.lock"))).toBe(false)
    },
  )
})
