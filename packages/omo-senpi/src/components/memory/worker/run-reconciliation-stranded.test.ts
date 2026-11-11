import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readdirSync } from "node:fs"
import { chmod, mkdir, readFile, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { writeRunJsonAtomic } from "./run-artifacts"
import { reconcileReflectionRuns } from "./run-reconciliation"
import { cleanupReconciliationFixtures, reconciliationFixture as fixture } from "./run-reconciliation.test-support"

afterEach(cleanupReconciliationFixtures)

const NOW = Date.parse("2026-08-10T01:00:00.000Z")

function liveLauncher() {
  return {
    hostname: () => "fixture-host",
    now: () => NOW,
    getPidLiveness: (pid: number) => (pid === 111 ? ("alive" as const) : ("dead" as const)),
  }
}

async function aged(path: string, ms: number): Promise<void> {
  const at = new Date(NOW - ms)
  await utimes(path, at, at)
}

describe("stranded run dirs with no ledger, outside the active reservation (#11976 4.2)", () => {
  test("#given prelaunch.json only 20 min old, a bare dir 2 min old and a bare dir 20 min old #when reconciled #then the first and third get quarantined.json(stranded_no_ledger) and the second is kept (C11, C24)", async () => {
    // given
    const item = await fixture()
    const runs = join(item.identity.paths.reflection, "runs")
    await mkdir(join(runs, "run-10"), { recursive: true })
    await writeRunJsonAtomic(join(runs, "run-10", "prelaunch.json"), {
      version: 1,
      runId: "run-10",
      worktreeDir: "/x",
      worktreeBranch: "b",
    })
    await aged(join(runs, "run-10", "prelaunch.json"), 20 * 60_000)
    await mkdir(join(runs, "run-11"), { recursive: true })
    await aged(join(runs, "run-11"), 2 * 60_000)
    await mkdir(join(runs, "run-12"), { recursive: true })
    await aged(join(runs, "run-12"), 20 * 60_000)

    // when
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...liveLauncher() })

    // then
    expect(JSON.parse(await readFile(join(runs, "run-10", "quarantined.json"), "utf8"))).toMatchObject({
      runId: "run-10",
      reason: "stranded_no_ledger",
      generation: new Date(NOW - 20 * 60_000).toISOString(),
    })
    expect(existsSync(join(runs, "run-11", "quarantined.json"))).toBe(false)
    expect(JSON.parse(await readFile(join(runs, "run-12", "quarantined.json"), "utf8"))).toMatchObject({
      runId: "run-12",
      reason: "stranded_no_ledger",
    })
  }, 30_000)

  test("#given a stranded bare dir 20 min old holding read-only payload files #when reconciled #then quarantined.json is written beside them", async () => {
    // given
    const item = await fixture()
    const dir = join(item.identity.paths.reflection, "runs", "run-12")
    await mkdir(dir, { recursive: true })
    for (const name of ["reflection-persona.md", "reflection-task.md", "transcript-payload.json"]) {
      await writeFile(join(dir, name), "payload")
      await chmod(join(dir, name), 0o400)
    }
    await aged(dir, 20 * 60_000)

    // when
    await reconcileReflectionRuns({ identity: item.identity, reservation: item.store, ...liveLauncher() })

    // then
    expect(JSON.parse(await readFile(join(dir, "quarantined.json"), "utf8"))).toMatchObject({
      reason: "stranded_no_ledger",
    })
  }, 30_000)

  test("#given a crash tombstone beside the run dirs #when reconciled #then it is never reconciled or counted as a run", async () => {
    // given
    const item = await fixture()
    const tombstone = join(item.identity.paths.reflection, "runs", ".prune-run-3-0b1c")
    await mkdir(tombstone, { recursive: true })
    await aged(tombstone, 20 * 60_000)

    // when
    const results = await reconcileReflectionRuns({
      identity: item.identity,
      reservation: item.store,
      ...liveLauncher(),
    })

    // then
    expect(results.map((result) => result.runId)).not.toContain(".prune-run-3-0b1c")
    expect(readdirSync(tombstone)).toEqual([])
  }, 30_000)
})
