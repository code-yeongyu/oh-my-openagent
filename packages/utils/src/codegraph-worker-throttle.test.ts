import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sweepCodegraphZombies } from "./codegraph/process-sweep"

describe("CodeGraph worker sweep cadence", () => {
  it("#given a fresh daemon sweep stamp #when an orphaned worker appears #then worker reaping still runs", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-throttle-"))
    const installDir = "/tmp/omo-codegraph-worker-throttle"
    const calls: string[] = []
    try {
      const nowMs = Date.UTC(2026, 6, 27, 1, 0, 0)
      await sweepCodegraphZombies({
        force: true,
        homeDir,
        nowMs,
        ownedRoots: [installDir],
        processProvider: () => Promise.resolve([]),
      })
      const workerCommand = `${installDir}/node --liftoff-only ${installDir}/lib/dist/bin/codegraph.js status --json`
      const daemonCommand = `${installDir}/node --liftoff-only ${installDir}/lib/dist/bin/codegraph.js serve --mcp --path /tmp/project`

      // when
      const result = await sweepCodegraphZombies({
        graceMs: 0,
        homeDir,
        killer: {
          isAlive: () => false,
          kill: (pid) => {
            calls.push(`kill:${pid}`)
            return Promise.resolve()
          },
          terminate: (pid) => {
            calls.push(`term:${pid}`)
            return Promise.resolve()
          },
        },
        nowMs: nowMs + 1_000,
        ownedRoots: [installDir],
        platform: "darwin",
        processProvider: () => Promise.resolve([
          { command: workerCommand, pid: 96100, ppid: 1 },
          { command: daemonCommand, pid: 96101, ppid: 1 },
        ]),
      })

      // then
      expect(result.action).toBe("swept")
      expect(result.workerAction).toBe("swept")
      expect(result.daemonAction).toBe("throttled")
      expect(result.killed.map((processInfo) => processInfo.pid)).toEqual([96100])
      expect(calls).toEqual(["term:96100"])
      expect(result.workerStampFile).not.toBe(result.daemonStampFile)
      expect(result.stampFile).toBe(result.daemonStampFile)
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given a live daemon lock and an orphaned worker #when both sweep lanes run #then the worker is killed and the daemon is spared", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-worker-daemon-"))
    const installDir = "/tmp/omo-codegraph-worker-daemon"
    const projectRoot = join(homeDir, "project")
    const daemonPid = 96201
    const calls: string[] = []
    try {
      mkdirSync(join(projectRoot, ".codegraph"), { recursive: true })
      writeFileSync(join(projectRoot, ".codegraph", "daemon.pid"), `${daemonPid}\n`)
      const workerCommand = `${installDir}/node --liftoff-only ${installDir}/lib/dist/bin/codegraph.js sync`
      const daemonCommand = `${installDir}/node --liftoff-only ${installDir}/lib/dist/bin/codegraph.js serve --mcp --path ${projectRoot}`

      // when
      const result = await sweepCodegraphZombies({
        force: true,
        graceMs: 0,
        homeDir,
        killer: {
          isAlive: () => false,
          kill: (pid) => {
            calls.push(`kill:${pid}`)
            return Promise.resolve()
          },
          terminate: (pid) => {
            calls.push(`term:${pid}`)
            return Promise.resolve()
          },
        },
        ownedRoots: [installDir],
        platform: "darwin",
        processProvider: () => Promise.resolve([
          { command: workerCommand, pid: 96200, ppid: 1 },
          { command: daemonCommand, pid: daemonPid, ppid: 1 },
        ]),
      })

      // then
      expect(result.killed.map((processInfo) => processInfo.pid)).toEqual([96200])
      expect(result.spared.map((processInfo) => processInfo.pid)).toEqual([daemonPid])
      expect(calls).toEqual(["term:96200"])
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })
})
