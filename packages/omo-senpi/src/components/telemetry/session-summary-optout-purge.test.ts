import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { purgeOptedOutQueue } from "./session-summary-optout-purge"
import { createSummaryStorage, OWNER_STALE_MS, summaryDir, type WindowRecord } from "./session-summary-storage"
import { createTempStateDirs } from "./session-summary.test-support"

const LIVE = { pid: 424_242, bootId: "live" }
const DEAD = { pid: 0x7fff_fff0, bootId: "killed" }

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
      const stale = windowRecord(DEAD, Date.now() - OWNER_STALE_MS - 60_000, "/off")
      live.writeWindow("race", windowRecord(LIVE, Date.now(), "/on"))
      // The purge's read returns the dead owner's record that was there a moment ago.
      const storage = { ...live, readWindow: (key: string) => (key === "race" ? stale : live.readWindow(key)) }

      // when
      purgeOptedOutQueue({ stateDir: dir, isScopeConsented: () => false, isPidAlive, storage })

      // then
      const onDisk = JSON.parse(readFileSync(join(summaryDir(dir), "race.json"), "utf8"))
      expect(onDisk).toMatchObject({ owner: LIVE, scope: { cwd: "/on" } })
    } finally {
      dirs.cleanup()
    }
  })
})
