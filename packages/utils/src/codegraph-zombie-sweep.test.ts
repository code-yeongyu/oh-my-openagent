import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sweepCodegraphZombies } from "./codegraph/process-sweep"

function writeDaemonLock(projectDir: string, body: string): string {
  const lockDir = join(projectDir, ".codegraph")
  mkdirSync(lockDir, { recursive: true })
  const lockFile = join(lockDir, "daemon.pid")
  writeFileSync(lockFile, body)
  return lockFile
}

function daemonLockBody(pid: number, version = "1.4.1"): string {
  return `${JSON.stringify({ pid, socketPath: "/tmp/daemon.sock", startedAt: 1784615252733, version }, null, 2)}\n`
}

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

  it("#given a live daemon whose lockfile records its pid #when sweep runs #then the daemon appears in candidates and is spared", async () => {
    // given
    const installDir = "/tmp/omo-install"
    const projectDir = mkdtempSync(join(tmpdir(), "omo-codegraph-daemon-proj-"))
    const calls: string[] = []
    const logs: string[] = []
    try {
      writeDaemonLock(projectDir, daemonLockBody(601))
      const command = `${installDir}/node --liftoff-only ${installDir}/lib/dist/bin/codegraph.js serve --mcp --path ${projectDir}`

      // when
      const result = await sweepCodegraphZombies({
        force: true,
        killer: {
          isAlive: () => true,
          kill: (pid) => {
            calls.push(`kill:${pid}`)
            return Promise.resolve()
          },
          terminate: (pid) => {
            calls.push(`term:${pid}`)
            return Promise.resolve()
          },
        },
        log: (message) => logs.push(message),
        ownedRoots: [installDir],
        platform: "linux",
        processProvider: () => Promise.resolve([{ command, pid: 601, ppid: 1 }]),
      })

      // then
      expect(result.candidates.map((processInfo) => processInfo.pid)).toEqual([601])
      expect(result.candidates[0]?.matchKind).toBe("upstream-daemon")
      expect(result.spared.map((processInfo) => processInfo.pid)).toEqual([601])
      expect(result.killed).toEqual([])
      expect(calls).toEqual([])
      expect(logs.some((message) => message.includes("601"))).toBe(true)
    } finally {
      rmSync(projectDir, { force: true, recursive: true })
    }
  })

  it("#given a daemon-shaped process with no lockfile #when sweep runs #then it is killed as provably stale", async () => {
    // given
    const installDir = "/tmp/omo-install"
    const projectDir = mkdtempSync(join(tmpdir(), "omo-codegraph-daemon-proj-"))
    try {
      const command = `${installDir}/bin/codegraph serve --mcp --path ${projectDir}`

      // when
      const result = await sweepCodegraphZombies({
        force: true,
        graceMs: 0,
        killer: {
          isAlive: () => false,
          kill: () => Promise.resolve(),
          terminate: () => Promise.resolve(),
        },
        ownedRoots: [installDir],
        platform: "linux",
        processProvider: () => Promise.resolve([{ command, pid: 602, ppid: 1 }]),
      })

      // then
      expect(result.candidates.map((processInfo) => processInfo.pid)).toEqual([602])
      expect(result.killed.map((processInfo) => processInfo.pid)).toEqual([602])
      expect(result.spared).toEqual([])
    } finally {
      rmSync(projectDir, { force: true, recursive: true })
    }
  })

  it("#given a daemon-shaped process whose lockfile records a different pid #when sweep runs #then it is killed as provably stale", async () => {
    // given
    const installDir = "/tmp/omo-install"
    const projectDir = mkdtempSync(join(tmpdir(), "omo-codegraph-daemon-proj-"))
    try {
      writeDaemonLock(projectDir, daemonLockBody(999))
      const command = `${installDir}/bin/codegraph serve --mcp --path ${projectDir}`

      // when
      const result = await sweepCodegraphZombies({
        force: true,
        graceMs: 0,
        killer: {
          isAlive: () => false,
          kill: () => Promise.resolve(),
          terminate: () => Promise.resolve(),
        },
        ownedRoots: [installDir],
        platform: "linux",
        processProvider: () => Promise.resolve([{ command, pid: 603, ppid: 1 }]),
      })

      // then
      expect(result.killed.map((processInfo) => processInfo.pid)).toEqual([603])
      expect(result.spared).toEqual([])
    } finally {
      rmSync(projectDir, { force: true, recursive: true })
    }
  })

  it("#given a daemon-shaped process whose lockfile is unparseable #when sweep runs #then it is spared because staleness is unprovable", async () => {
    // given
    const installDir = "/tmp/omo-install"
    const projectDir = mkdtempSync(join(tmpdir(), "omo-codegraph-daemon-proj-"))
    const logs: string[] = []
    try {
      writeDaemonLock(projectDir, "not-a-pid-not-json\n")
      const command = `${installDir}/bin/codegraph serve --mcp --path ${projectDir}`

      // when
      const result = await sweepCodegraphZombies({
        force: true,
        killer: {
          isAlive: () => false,
          kill: () => Promise.resolve(),
          terminate: () => Promise.resolve(),
        },
        log: (message) => logs.push(message),
        ownedRoots: [installDir],
        platform: "linux",
        processProvider: () => Promise.resolve([{ command, pid: 604, ppid: 1 }]),
      })

      // then
      expect(result.killed).toEqual([])
      expect(result.spared.map((processInfo) => processInfo.pid)).toEqual([604])
      expect(logs.some((message) => message.includes("604"))).toBe(true)
    } finally {
      rmSync(projectDir, { force: true, recursive: true })
    }
  })

  it("#given a legacy plain-pid lockfile that records the daemon pid #when sweep runs #then the daemon is spared", async () => {
    // given
    const installDir = "/tmp/omo-install"
    const projectDir = mkdtempSync(join(tmpdir(), "omo-codegraph-daemon-proj-"))
    try {
      writeDaemonLock(projectDir, "605\n")
      const command = `${installDir}/bin/codegraph serve --mcp --path ${projectDir}`

      // when
      const result = await sweepCodegraphZombies({
        force: true,
        killer: {
          isAlive: () => false,
          kill: () => Promise.resolve(),
          terminate: () => Promise.resolve(),
        },
        ownedRoots: [installDir],
        platform: "linux",
        processProvider: () => Promise.resolve([{ command, pid: 605, ppid: 1 }]),
      })

      // then
      expect(result.killed).toEqual([])
      expect(result.spared.map((processInfo) => processInfo.pid)).toEqual([605])
    } finally {
      rmSync(projectDir, { force: true, recursive: true })
    }
  })

  it("#given a daemon running an older version with a matching lock pid #when sweep runs #then it is spared because upstream already refuses mismatched clients", async () => {
    // given
    const installDir = "/tmp/omo-install"
    const projectDir = mkdtempSync(join(tmpdir(), "omo-codegraph-daemon-proj-"))
    try {
      writeDaemonLock(projectDir, daemonLockBody(606, "1.0.1"))
      const command = `${installDir}/bin/codegraph serve --mcp --path ${projectDir}`

      // when
      const result = await sweepCodegraphZombies({
        force: true,
        killer: {
          isAlive: () => false,
          kill: () => Promise.resolve(),
          terminate: () => Promise.resolve(),
        },
        ownedRoots: [installDir],
        platform: "linux",
        processProvider: () => Promise.resolve([{ command, pid: 606, ppid: 1 }]),
      })

      // then
      expect(result.killed).toEqual([])
      expect(result.spared.map((processInfo) => processInfo.pid)).toEqual([606])
    } finally {
      rmSync(projectDir, { force: true, recursive: true })
    }
  })

  it("#given the daemon lock lives at an initialized ancestor of the --path root #when sweep runs #then the daemon is spared", async () => {
    // given
    const installDir = "/tmp/omo-install"
    const ancestorDir = mkdtempSync(join(tmpdir(), "omo-codegraph-daemon-ancestor-"))
    const nestedDir = join(ancestorDir, "sub", "dir")
    try {
      mkdirSync(nestedDir, { recursive: true })
      writeDaemonLock(ancestorDir, daemonLockBody(607))
      const command = `${installDir}/bin/codegraph serve --mcp --path ${nestedDir}`

      // when
      const result = await sweepCodegraphZombies({
        force: true,
        killer: {
          isAlive: () => false,
          kill: () => Promise.resolve(),
          terminate: () => Promise.resolve(),
        },
        ownedRoots: [installDir],
        platform: "linux",
        processProvider: () => Promise.resolve([{ command, pid: 607, ppid: 1 }]),
      })

      // then
      expect(result.killed).toEqual([])
      expect(result.spared.map((processInfo) => processInfo.pid)).toEqual([607])
    } finally {
      rmSync(ancestorDir, { force: true, recursive: true })
    }
  })

  it("#given a dry run against a live daemon #when sweep runs #then the daemon is listed as spared without any kill", async () => {
    // given
    const installDir = "/tmp/omo-install"
    const projectDir = mkdtempSync(join(tmpdir(), "omo-codegraph-daemon-proj-"))
    const calls: string[] = []
    try {
      writeDaemonLock(projectDir, daemonLockBody(608))
      const command = `${installDir}/bin/codegraph serve --mcp --path ${projectDir}`

      // when
      const result = await sweepCodegraphZombies({
        dryRun: true,
        force: true,
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
        platform: "linux",
        processProvider: () => Promise.resolve([{ command, pid: 608, ppid: 1 }]),
      })

      // then
      expect(result.candidates.map((processInfo) => processInfo.pid)).toEqual([608])
      expect(result.spared.map((processInfo) => processInfo.pid)).toEqual([608])
      expect(result.killed).toEqual([])
      expect(calls).toEqual([])
    } finally {
      rmSync(projectDir, { force: true, recursive: true })
    }
  })
})
