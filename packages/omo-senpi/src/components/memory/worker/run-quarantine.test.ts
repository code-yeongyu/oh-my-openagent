import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { hostname } from "node:os"
import { join } from "node:path"

import { appendMemoryReceiptOnce, readMemoryReceipts, receiptIdentity, type MemoryReceiptInput } from "@oh-my-opencode/memory-core"

import type { MemoryReceiptsPort } from "../receipts-port"
import { writeRunJsonAtomic } from "./run-artifacts"
import { reconcileReflectionRuns } from "./run-reconciliation"
import {
  cleanupReconciliationFixtures,
  queuePendingReservation,
  reconciliationFixture as fixture,
} from "./run-reconciliation.test-support"

const sleepers: ChildProcess[] = []
afterEach(async () => {
  for (const sleeper of sleepers.splice(0)) sleeper.kill("SIGKILL")
  await cleanupReconciliationFixtures()
})

type Item = Awaited<ReturnType<typeof fixture>>

function deadLauncher() {
  return {
    hostname: () => "fixture-host",
    now: () => Date.parse("2026-08-10T00:10:00.000Z"),
    getPidLiveness: () => "dead" as const,
  }
}

async function snapshot(runDir: string, names: readonly string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(join(runDir, name), "utf8")] as const)))
}

async function quarantine(item: Item): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(item.runDir, "quarantined.json"), "utf8"))
}

async function receipts(item: Item) {
  return (await readMemoryReceipts(item.identity.paths.runtime, {})).receipts
}

describe("quarantine of runs reconciliation cannot recover", () => {
  test("#given a finished run with corrupt terminal timestamps under a dead launcher #when reconciled twice #then it is released, never quarantined, and has one terminal receipt", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "final.json"), { version: 1, runId: item.ledger.runId, outcome: "merged", finishedAt: "not-a-date" })
    await queuePendingReservation(item)
    const before = await snapshot(item.runDir, ["ledger.json", "final.json", "prelaunch.json"])
    const launched: string[] = []

    // when
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, launch: (run) => launched.push(run.runId), ...deadLauncher() })
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, launch: (run) => launched.push(run.runId), ...deadLauncher() })

    // then
    expect(existsSync(join(item.runDir, "quarantined.json"))).toBe(false)
    expect(await snapshot(item.runDir, ["ledger.json", "final.json", "prelaunch.json"])).toEqual(before)
    expect((await receipts(item)).filter((receipt) => receipt.kind !== "facts" && receipt.runId === "run-orphan").map((receipt) => receipt.event)).toEqual(["merged"])
    expect(launched).toEqual(["run-pending"])
  }, 30_000)

  test("#given an unparseable ledger whose recorded supervisor is still alive under a dead launcher #when reconciled #then nothing is quarantined and the reservation stays", async () => {
    // given
    const item = await fixture()
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" })
    sleepers.push(sleeper)
    await writeFile(join(item.runDir, "ledger.json"), JSON.stringify({ ...item.ledger, mergePolicy: "future-policy", launching: false, pid: sleeper.pid, processStart: null }))

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher(), getPidLiveness: (pid) => pid === sleeper.pid ? "alive" : "dead" })

    // then
    expect(results).toEqual([])
    expect(existsSync(join(item.runDir, "quarantined.json"))).toBe(false)
    expect((await item.store.readState()).active?.runId).toBe("run-orphan")
  }, 30_000)

  test("#given a run dir with no prelaunch or ledger still inside the launch window under a dead launcher #when reconciled #then it is left alone", async () => {
    // given
    const item = await fixture()
    await rm(join(item.runDir, "ledger.json"))
    await rm(join(item.runDir, "prelaunch.json"))
    const recent = new Date(deadLauncher().now() - 30_000)
    await utimes(item.runDir, recent, recent)

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher() })

    // then
    expect(results).toEqual([])
    expect(existsSync(join(item.runDir, "quarantined.json"))).toBe(false)
    expect((await item.store.readState()).active?.runId).toBe("run-orphan")
  }, 30_000)

  test("#given corrupt terminal timestamps under a launcher on another host #when reconciled #then nothing is quarantined and the reservation stays", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "final.json"), { version: 1, runId: item.ledger.runId, outcome: "merged", finishedAt: "not-a-date" })

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher(), hostname: () => "another-host" })

    // then
    expect(results).toEqual([])
    expect(existsSync(join(item.runDir, "quarantined.json"))).toBe(false)
    expect((await item.store.readState()).active?.runId).toBe("run-orphan")
  }, 30_000)

  test("#given an unreadable ledger under a dead launcher #when reconciled #then the run is quarantined with the reservation's generation", async () => {
    // given
    const item = await fixture()
    await writeFile(join(item.runDir, "ledger.json"), "{ not json")
    const activeBefore = JSON.parse(await readFile(join(item.identity.paths.reflection, "active.lock"), "utf8"))

    // when
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher() })

    // then
    expect(await quarantine(item)).toMatchObject({
      runId: "run-orphan", kind: "reflection", trigger: "step-count",
      generation: activeBefore.reservedAt, reason: "ledger_unreadable",
    })
    expect(JSON.parse(await readFile(join(item.runDir, "reservation.quarantined.json"), "utf8"))).toEqual(activeBefore)
    expect(await readFile(join(item.runDir, "ledger.json"), "utf8")).toBe("{ not json")
    expect((await item.store.readState()).active).toBeUndefined()
  }, 30_000)

  test("#given an unreadable ledger under a launcher that is still alive #when reconciled #then nothing is quarantined and nothing is written", async () => {
    // given
    const item = await fixture()
    await writeFile(join(item.runDir, "ledger.json"), "{ not json")
    const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], { stdio: "ignore" })
    sleepers.push(sleeper)
    const activePath = join(item.identity.paths.reflection, "active.lock")
    await writeFile(activePath, JSON.stringify({
      ...JSON.parse(await readFile(activePath, "utf8")),
      launcherPid: sleeper.pid,
      launcherHostname: hostname(),
      launcherProcessStart: null,
    }))

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store })

    // then
    expect(results).toEqual([])
    expect(existsSync(join(item.runDir, "quarantined.json"))).toBe(false)
    expect(existsSync(join(item.runDir, "reservation.quarantined.json"))).toBe(false)
    expect((await item.store.readState()).active?.runId).toBe("run-orphan")
  }, 30_000)

  test("#given the quarantined receipt write fails once #when reconciled again with the real writer #then exactly one quarantined receipt carries the sentinel's identity", async () => {
    // given
    const item = await fixture()
    await writeFile(join(item.runDir, "ledger.json"), "{ not json")
    const warnings: string[] = []
    let thrown = 0
    const flaky: MemoryReceiptsPort = {
      append: async (runtimeDir: string, input: MemoryReceiptInput) => {
        if (input.event === "quarantined" && thrown === 0) {
          thrown++
          throw new Error("receipt write lost")
        }
        return appendMemoryReceiptOnce(runtimeDir, input)
      },
    }
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, receipts: flaky, warn: (message) => warnings.push(message), ...deadLauncher() })
    const sentinel = await quarantine(item)
    const after = { thrown, warnings: warnings.length, lines: (await receipts(item)).length }

    // when
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher() })
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher() })

    // then
    expect(after).toEqual({ thrown: 1, warnings: 1, lines: 0 })
    const written = (await receipts(item)).filter((receipt) => receipt.event === "quarantined")
    expect(written).toHaveLength(1)
    const [receipt] = written
    if (receipt === undefined || receipt.kind === "facts") throw new Error("expected a run receipt")
    expect(receiptIdentity({ kind: receipt.kind, runId: receipt.runId, event: "quarantined", generation: receipt.generation }))
      .toBe(receiptIdentity({ kind: "reflection", runId: "run-orphan", event: "quarantined", generation: String(sentinel.generation) }))
    expect(await quarantine(item)).toEqual(sentinel)
  }, 30_000)

  test("#given a run dir with no prelaunch or ledger past the launch deadline under a dead launcher #when reconciled #then it is quarantined", async () => {
    // given
    const item = await fixture()
    await rm(join(item.runDir, "ledger.json"))
    await rm(join(item.runDir, "prelaunch.json"))
    await mkdir(join(item.runDir, "child-logs"), { recursive: true })
    const long = new Date("2026-08-10T00:00:00.000Z")
    await utimes(item.runDir, long, long)

    // when
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher() })

    // then
    expect(await quarantine(item)).toMatchObject({ reason: "prelaunch_missing_after_deadline", trigger: "step-count" })
    expect(existsSync(join(item.runDir, "child-logs"))).toBe(true)
    expect((await item.store.readState()).active).toBeUndefined()
  }, 30_000)

  test("#given a run dir already quarantined beside a finishable outcome #when reconciled twice #then it is never finalized and gets one receipt", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "outcome.json"), {
      version: 1, runId: item.ledger.runId, finishedAt: "2026-08-10T00:00:30.000Z", childExit: { code: 0, signal: null }, timedOut: false,
    })
    await writeRunJsonAtomic(join(item.runDir, "quarantined.json"), {
      version: 1, runId: item.ledger.runId, kind: "reflection", trigger: "step-count",
      generation: item.ledger.startedAt, reason: "ledger_unreadable", quarantinedAt: "2026-08-10T00:05:00.000Z", evidence: ["ledger.json"],
    })

    // when
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store })
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store })

    // then
    expect(existsSync(join(item.runDir, "final.json"))).toBe(false)
    expect((await receipts(item)).map((receipt) => receipt.event)).toEqual(["quarantined"])
  }, 30_000)

  test("#given a terminal claim that cannot be read #when reconciliation abandons the run #then it is quarantined instead of throwing", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), { ...item.ledger, launching: false, pid: 4242 })
    await mkdir(join(item.runDir, "terminal-claim.json", "stuck"), { recursive: true })

    // when
    await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      waitForOutcome: async () => "timeout",
      ...deadLauncher(),
      getPidLiveness: () => "unknown" as const,
    })

    // then
    expect(await quarantine(item)).toMatchObject({ reason: "terminal_claim_unrecoverable", generation: item.ledger.startedAt })
    expect((await item.store.readState()).active).toBeUndefined()
  }, 30_000)

  test("#given a finished run whose ledger was later corrupted #when reconciled #then it is a historical record and is not quarantined", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "final.json"), { version: 1, runId: item.ledger.runId, outcome: "merged", finishedAt: "2026-08-10T00:00:30.000Z" })
    await writeFile(join(item.runDir, "ledger.json"), "{ not json")

    // when
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher() })

    // then
    expect(existsSync(join(item.runDir, "quarantined.json"))).toBe(false)
  }, 30_000)
})
