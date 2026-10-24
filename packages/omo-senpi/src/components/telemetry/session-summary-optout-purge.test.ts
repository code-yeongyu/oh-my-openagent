import { describe, expect, test } from "bun:test"
import { copyFileSync, readdirSync, readFileSync, renameSync } from "node:fs"
import { join } from "node:path"

import { purgeOptedOutQueue } from "./session-summary-optout-purge"
import { withRecoveryOps } from "./session-summary-recovery-storage"
import { createSummaryStorage, OWNER_STALE_MS, summaryDir, type WindowRecord } from "./session-summary-storage"
import { purgeUnconsentedQueue } from "./session-summary-purge"
import { createTempStateDirs, createTestRecorder, summaryTurn } from "./session-summary.test-support"

const LIVE = { pid: 424_242, bootId: "live" }
const DEAD = { pid: 0x7fff_fff0, bootId: "killed" }
const PURGER = { pid: process.pid, bootId: "purger" }

function windowRecord(owner: typeof LIVE, heartbeatAt: number, cwd: string): WindowRecord {
  return {
    consent: "enabled", scope: { cwd }, sessionHash: "race", sessionRole: "root", owner, heartbeatAt,
    epoch: "0123456789abcdef", seq: 1, sampleRate: 0, windowId: null, window: null,
  }
}

describe("purgeOptedOutQueue against a live writer", () => {
  // The purge decides on what it read; a live opted-in process can rewrite the same file before the purge acts
  // on that decision. Deleting by path would then destroy the live process's window.
  test("#given a dead owner's window the purge has read #when a live owner rewrites that file before the delete #then the live window survives", () => {
    const dirs = createTempStateDirs()
    try {
      const dir = dirs.make()
      const isPidAlive = (pid: number) => pid === LIVE.pid
      const live = createSummaryStorage({ stateDir: dir, owner: LIVE, isPidAlive })
      const purger = withRecoveryOps(createSummaryStorage({ stateDir: dir, owner: PURGER, isPidAlive }))
      const stale = windowRecord(DEAD, Date.now() - OWNER_STALE_MS - 60_000, "/off")
      live.writeWindow("race", windowRecord(LIVE, Date.now(), "/on"))
      // The purge's read returns the dead owner's record that was there a moment ago.
      const storage = { ...purger, readWindow: (key: string) => (key === "race" ? stale : purger.readWindow(key)) }

      // when
      purgeOptedOutQueue({ storage, isScopeConsented: () => false })

      // then
      const onDisk = JSON.parse(readFileSync(join(summaryDir(dir), "race.json"), "utf8"))
      expect(onDisk).toMatchObject({ owner: LIVE, scope: { cwd: "/on" } })
    } finally {
      dirs.cleanup()
    }
  })
})

describe("the entry purge against a live owner's write in progress", () => {
  // Lead ruling (2026-10-24): the persisted setting off means the data goes, a live owner's window included. The
  // owner must survive that: its rename lands on a deleted path, and it carries on with its next turn.
  test("#given a live owner whose window write sits in its temp file #when an opted-out process's entry purge runs before the rename #then the owner's next turn and shutdown neither throw nor leave a corrupt file", async () => {
    const dirs = createTempStateDirs()
    try {
      const dir = dirs.make()
      const owner = createTestRecorder({ dir })
      await owner.summary.recordTurn("race", summaryTurn())
      const base = summaryDir(dir)
      const window = readdirSync(base).find((name) => name.endsWith(".json"))
      if (window === undefined) throw new Error("the owner wrote no window")
      const path = join(base, window)
      // The owner's next write: its temp file is complete, the rename has not happened yet.
      const temp = `${path}.${process.pid}-in-progress.tmp`
      copyFileSync(path, temp)

      // when
      purgeUnconsentedQueue(dir, () => false)
      expect(readdirSync(base).filter((name) => name.endsWith(".json"))).toEqual([])
      renameSync(temp, path)

      // then
      await owner.summary.recordTurn("race", summaryTurn())
      await owner.summary.finish("race", "shutdown")
      owner.summary.dispose()
      for (const name of readdirSync(base, { recursive: true, encoding: "utf8" }).filter((entry) => entry.endsWith(".json"))) {
        expect(() => JSON.parse(readFileSync(join(base, name), "utf8"))).not.toThrow()
      }
      expect(owner.diagnostics.filter(({ event }) => event === "telemetry_capture_failed")).toEqual([])
    } finally {
      dirs.cleanup()
    }
  })
})
