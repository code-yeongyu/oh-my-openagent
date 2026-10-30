import { afterEach, describe, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { classifyGhostActive } from "./run-ghost-active"
import { writeRunJsonAtomic } from "./run-artifacts"
import { reconcileReflectionRuns } from "./run-reconciliation"
import {
  cleanupReconciliationFixtures,
  reconciliationFixture as fixture,
} from "./run-reconciliation.test-support"

afterEach(cleanupReconciliationFixtures)

const OLDER_STARTED_AT = "2026-08-09T23:59:54.000Z"

function deadLauncher() {
  return {
    hostname: () => "fixture-host",
    now: () => Date.parse("2026-08-10T00:01:01.001Z"),
    getPidLiveness: () => "dead" as const,
  }
}

function liveLauncher() {
  return {
    hostname: () => "fixture-host",
    now: () => Date.parse("2026-08-10T00:01:01.001Z"),
    getPidLiveness: (pid: number) => pid === 111 || pid === 222 ? "alive" as const : "dead" as const,
    getProcessStartIdentity: async (pid: number) => pid === 111 ? "launcher-start" : pid === 222 ? "supervisor-two" : null,
  }
}

const LIVE_SUPERVISOR_LEDGER = { pid: 222, processStart: "supervisor-two", childPid: 333, childProcessStart: "child-two" } as const

async function stripActiveFields(item: Awaited<ReturnType<typeof fixture>>, fields: readonly string[]) {
  const activePath = join(item.identity.paths.reflection, "active.lock")
  const active = JSON.parse(await readFile(activePath, "utf8"))
  for (const field of fields) delete active[field]
  await writeFile(activePath, JSON.stringify(active))
}

function retiredArtifactsIntact(item: Awaited<ReturnType<typeof fixture>>): boolean {
  return existsSync(join(item.runDir, "ledger.json"))
    && existsSync(join(item.runDir, "prelaunch.json"))
    && existsSync(item.worktree.dir)
    && !existsSync(join(item.runDir, "final.json"))
}

describe("ghost active reservation reconciliation", () => {
  test("#given a reservation without launcher identity #when reconciled #then it is reclaimed as failed and the run dir is left intact", async () => {
    // given
    const item = await fixture("dream")
    await stripActiveFields(item, ["reservedAt", "launcherPid", "launcherHostname", "launcherProcessStart"])

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    expect((await item.store.readState()).active).toBeUndefined()
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
    expect(retiredArtifactsIntact(item)).toBe(true)
  }, 30_000)

  test("#given a reservation missing only reservedAt #when its launcher is alive #then the probe defers the reclaim", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), { ...item.ledger, ...LIVE_SUPERVISOR_LEDGER })
    await stripActiveFields(item, ["reservedAt"])

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...liveLauncher() })

    // then
    expect(results).toEqual([])
    expect((await item.store.readState()).active?.runId).toBe("run-orphan")
    expect(retiredArtifactsIntact(item)).toBe(true)
  }, 30_000)

  test("#given a reservation missing only reservedAt #when its launcher is dead #then it is reclaimed", async () => {
    // given
    const item = await fixture()
    await stripActiveFields(item, ["reservedAt"])

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher() })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    expect((await item.store.readState()).active).toBeUndefined()
  }, 30_000)

  test("#given an older ledger with no terminal artifact #when the launcher is dead #then the shadowed reservation is reclaimed and the retired dir is left for a later pass", async () => {
    // given
    const item = await fixture("dream")
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), { ...item.ledger, startedAt: OLDER_STARTED_AT })

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher() })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    expect((await item.store.readState()).active).toBeUndefined()
    expect((await item.journal.getState()).reflected_completed_steps).toBe(0)
    expect(retiredArtifactsIntact(item)).toBe(true)
  }, 30_000)

  test("#given an older ledger with no terminal artifact #when the launcher is alive #then nothing is reclaimed and the retired dir is not settled against the live reservation", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), {
      ...item.ledger,
      ...LIVE_SUPERVISOR_LEDGER,
      startedAt: OLDER_STARTED_AT,
    })

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...liveLauncher() })

    // then
    expect(results).toEqual([])
    expect((await item.store.readState()).active?.runId).toBe("run-orphan")
    expect(retiredArtifactsIntact(item)).toBe(true)
  }, 30_000)

  test("#given a ledger inside the generation slack #when the launcher is dead #then the reservation is not treated as a ghost", async () => {
    // given
    const item = await fixture()
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), { ...item.ledger, startedAt: "2026-08-09T23:59:57.000Z" })

    // when
    const results = await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...deadLauncher() })

    // then
    expect(results).toEqual([{ runId: "run-orphan", outcome: "failed" }])
    expect(existsSync(join(item.runDir, "final.json"))).toBe(true)
  }, 30_000)

  test("#given boundary inputs #when classifying #then only provable ghosts are flagged", async () => {
    // given
    const item = await fixture()
    const active = (await item.store.readState()).active
    if (active === undefined) throw new Error("expected active reservation")

    // when / then
    expect(await classifyGhostActive({ identity: item.identity, active })).toEqual({ ghost: false })
    expect(await classifyGhostActive({ identity: item.identity, active: { ...active, reservedAt: undefined } }))
      .toEqual({ ghost: true, reason: "missing-identity" })
    await writeRunJsonAtomic(join(item.runDir, "final.json"), { version: 1, runId: "run-orphan", outcome: "merged", finishedAt: "2026-08-09T23:59:55.000Z" })
    await writeRunJsonAtomic(join(item.runDir, "ledger.json"), { ...item.ledger, startedAt: OLDER_STARTED_AT })
    expect(await classifyGhostActive({ identity: item.identity, active })).toEqual({ ghost: false })
  }, 30_000)
})
