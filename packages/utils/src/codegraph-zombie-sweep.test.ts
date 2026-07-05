import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, statSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sweepCodegraphZombies } from "./codegraph/process-sweep"

describe("CodeGraph zombie sweep", () => {
  it("#given a dry run #when matching zombies are found #then it reports candidates without killing", async () => {
    // given
    const omoRoot = "/tmp/omo-owned-plugin"
    const killed: string[] = []

    // when
    const result = await sweepCodegraphZombies({
      dryRun: true,
      force: true,
      killer: {
        isAlive: () => true,
        kill: (pid) => {
          killed.push(`kill:${pid}`)
          return Promise.resolve()
        },
        terminate: (pid) => {
          killed.push(`term:${pid}`)
          return Promise.resolve()
        },
      },
      ownedRoots: [omoRoot],
      platform: "linux",
      processProvider: () => Promise.resolve([
        {
          command: `${process.execPath} ${omoRoot}/components/codegraph/dist/serve.js`,
          pid: 401,
          ppid: 1,
        },
      ]),
    })

    // then
    expect(result.killed.map((processInfo) => processInfo.pid)).toEqual([])
    expect(result.candidates.map((processInfo) => processInfo.pid)).toEqual([401])
    expect(killed).toEqual([])
  })

  it("#given a fresh throttle stamp #when sweep runs without force #then it skips process enumeration", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-sweep-home-"))
    try {
      const nowMs = Date.UTC(2026, 6, 6, 1, 0, 0)
      const stampDate = new Date(nowMs - 30 * 60 * 1_000)

      // when
      const first = await sweepCodegraphZombies({
        force: true,
        homeDir,
        nowMs,
        ownedRoots: ["/tmp/omo"],
        processProvider: () => Promise.resolve([]),
      })
      utimesSync(first.stampFile, stampDate, stampDate)
      const result = await sweepCodegraphZombies({
        homeDir,
        nowMs,
        ownedRoots: ["/tmp/omo"],
        processProvider: () => {
          throw new Error("process provider should not run while throttled")
        },
      })

      // then
      expect(result.action).toBe("throttled")
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given force with a fresh throttle stamp #when sweep runs #then it bypasses throttle and refreshes the stamp", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-sweep-home-"))
    try {
      const nowMs = Date.UTC(2026, 6, 6, 2, 0, 0)
      const first = await sweepCodegraphZombies({
        force: true,
        homeDir,
        nowMs: nowMs - 10 * 60 * 1_000,
        ownedRoots: ["/tmp/omo"],
        processProvider: () => Promise.resolve([]),
      })

      // when
      const result = await sweepCodegraphZombies({
        force: true,
        homeDir,
        nowMs,
        ownedRoots: ["/tmp/omo"],
        processProvider: () => Promise.resolve([]),
      })

      // then
      expect(result.action).toBe("swept")
      expect(statSync(first.stampFile).mtimeMs).toBeGreaterThanOrEqual(nowMs)
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given a zombie survives graceful termination #when sweep runs #then it escalates after SIGTERM", async () => {
    // given
    const omoRoot = "/tmp/omo-owned-plugin"
    const calls: string[] = []

    // when
    const result = await sweepCodegraphZombies({
      force: true,
      graceMs: 0,
      killer: {
        isAlive: (pid) => {
          calls.push(`alive:${pid}`)
          return true
        },
        kill: (pid) => {
          calls.push(`kill:${pid}`)
          return Promise.resolve()
        },
        terminate: (pid) => {
          calls.push(`term:${pid}`)
          return Promise.resolve()
        },
      },
      ownedRoots: [omoRoot],
      platform: "linux",
      processProvider: () => Promise.resolve([
        {
          command: `${process.execPath} ${omoRoot}/components/codegraph/dist/serve.js`,
          pid: 501,
          ppid: 1,
        },
      ]),
    })

    // then
    expect(result.killed.map((processInfo) => processInfo.pid)).toEqual([501])
    expect(calls).toEqual(["term:501", "alive:501", "kill:501"])
  })
})
