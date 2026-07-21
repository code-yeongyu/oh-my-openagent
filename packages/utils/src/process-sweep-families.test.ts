import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  attestLspDaemonCliProcess,
  selectOrphanedLspDaemonProxies,
  selectZombieCodegraphProcesses,
  sweepOrphanedLspDaemonProxies,
  sweepStaleLspDaemonVersions,
  type ProcessInfo,
} from "./process-sweep"

function daemonOwnerBody(pid: number): string {
  return `${JSON.stringify({
    endpoint: { kind: "unix", path: "/tmp/daemon.sock", dev: 1, ino: 1 },
    nonce: "nonce",
    pid,
    startedAt: "2026-07-21T00:00:00.000Z",
  })}\n`
}

function writeOwner(versionDir: string, pid: number): void {
  mkdirSync(versionDir, { recursive: true })
  writeFileSync(join(versionDir, "daemon.owner"), daemonOwnerBody(pid))
}

describe("process sweep family matrix", () => {
  const omoRoot = "/tmp/omo-plugin"
  const installDir = "/tmp/omo-install"

  const posixTable: readonly ProcessInfo[] = [
    { command: "codex app-server", pid: 200, ppid: 1 },
    // codegraph bridge (serve wrapper)
    { command: `node ${omoRoot}/components/codegraph/dist/serve.js`, pid: 301, ppid: 1 },
    // codegraph direct upstream
    {
      command: `node ${omoRoot}/node_modules/@colbymchenry/codegraph/bin/codegraph.js serve --mcp`,
      pid: 302,
      ppid: 9999,
    },
    // codegraph detached upstream daemon
    { command: `${installDir}/bin/codegraph serve --mcp --path /tmp/proj`, pid: 303, ppid: 1 },
    // lsp-daemon mcp proxy, orphaned (ppid 1)
    { command: `node ${omoRoot}/components/lsp-daemon/dist/cli.js mcp`, pid: 304, ppid: 1 },
    // lsp-daemon mcp proxy, live parent
    { command: `node ${omoRoot}/components/lsp-daemon/dist/cli.js mcp`, pid: 305, ppid: 200 },
    // lsp-daemon server shape: NEVER a proxy candidate even when orphaned
    { command: `node ${omoRoot}/components/lsp-daemon/dist/cli.js daemon`, pid: 306, ppid: 1 },
    // dev-shape lsp-daemon mcp proxy via bun + src/cli.ts, dead parent
    { command: `bun ${omoRoot}/components/lsp-daemon/src/cli.ts mcp`, pid: 307, ppid: 9999 },
    // lsp-daemon mcp proxy outside any owned root
    { command: `node /tmp/other-plugin/components/lsp-daemon/dist/cli.js mcp`, pid: 308, ppid: 1 },
  ]

  it("#given a posix process table spanning every family #when classifying #then each family selects exactly its own zombies", () => {
    // given / when
    const codegraph = selectZombieCodegraphProcesses(posixTable, {
      ownedRoots: [omoRoot, installDir],
      platform: "linux",
    })
    const proxies = selectOrphanedLspDaemonProxies(posixTable, { ownedRoots: [omoRoot], platform: "linux" })

    // then
    expect(codegraph.map((processInfo) => [processInfo.pid, processInfo.matchKind])).toEqual([
      [301, "serve-wrapper"],
      [302, "upstream-codegraph"],
      [303, "upstream-daemon"],
    ])
    expect(proxies.map((processInfo) => [processInfo.pid, processInfo.matchKind])).toEqual([
      [304, "lsp-daemon-proxy"],
      [307, "lsp-daemon-proxy"],
    ])
  })

  it("#given a windows process table spanning every family #when classifying #then windows shapes are selected per family", () => {
    // given
    const winRoot = "C:\\Users\\runner\\.codex\\plugins\\cache\\sisyphuslabs\\omo\\4.15.1"
    const table: readonly ProcessInfo[] = [
      { command: "codex.exe app-server", pid: 200, ppid: 4 },
      { command: `node ${winRoot}\\components\\codegraph\\dist\\serve.js`, pid: 311, ppid: 1 },
      { command: `node.exe ${winRoot}\\components\\lsp-daemon\\dist\\cli.js mcp`, pid: 312, ppid: 1 },
      { command: `node.exe ${winRoot}\\components\\lsp-daemon\\dist\\cli.js mcp`, pid: 313, ppid: 200 },
      { command: `node.exe ${winRoot}\\components\\lsp-daemon\\dist\\cli.js daemon`, pid: 314, ppid: 1 },
    ]

    // when
    const codegraph = selectZombieCodegraphProcesses(table, { ownedRoots: [winRoot], platform: "win32" })
    const proxies = selectOrphanedLspDaemonProxies(table, { ownedRoots: [winRoot], platform: "win32" })

    // then
    expect(codegraph.map((processInfo) => processInfo.pid)).toEqual([311])
    expect(proxies.map((processInfo) => processInfo.pid)).toEqual([312])
  })

  it("#given a proxy-shaped command with a daemon token alongside mcp #when selecting proxies #then the daemon server shape is never matched", () => {
    // given
    const table: readonly ProcessInfo[] = [
      { command: `node ${omoRoot}/components/lsp-daemon/dist/cli.js mcp daemon`, pid: 320, ppid: 1 },
      { command: `node ${omoRoot}/components/lsp-daemon/dist/cli.js mcp`, pid: 321, ppid: 1 },
    ]

    // when
    const proxies = selectOrphanedLspDaemonProxies(table, { ownedRoots: [omoRoot], platform: "linux" })

    // then
    expect(proxies.map((processInfo) => processInfo.pid)).toEqual([321])
  })

  it("#given an mcp token that belongs to an unrelated cli #when selecting proxies #then it is ignored", () => {
    // given
    const table: readonly ProcessInfo[] = [
      { command: `node ${omoRoot}/components/other-tool/dist/cli.js mcp`, pid: 330, ppid: 1 },
      { command: `/usr/bin/python3 ${omoRoot}/components/lsp-daemon/dist/cli.js mcp`, pid: 331, ppid: 1 },
    ]

    // when
    const proxies = selectOrphanedLspDaemonProxies(table, { ownedRoots: [omoRoot], platform: "linux" })

    // then
    expect(proxies).toEqual([])
  })
})

describe("orphaned lsp-daemon proxy sweep", () => {
  it("#given an orphaned proxy and a live-parent proxy #when sweeping #then only the orphan is killed and the family stamp is written", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-lsp-proxy-sweep-"))
    const omoRoot = "/tmp/omo-plugin"
    const calls: string[] = []
    try {
      // when
      const result = await sweepOrphanedLspDaemonProxies({
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
        ownedRoots: [omoRoot],
        platform: "linux",
        processProvider: () =>
          Promise.resolve([
            { command: "codex app-server", pid: 200, ppid: 1 },
            { command: `node ${omoRoot}/components/lsp-daemon/dist/cli.js mcp`, pid: 401, ppid: 1 },
            { command: `node ${omoRoot}/components/lsp-daemon/dist/cli.js mcp`, pid: 402, ppid: 200 },
          ]),
      })

      // then
      expect(result.action).toBe("swept")
      expect(result.killed.map((processInfo) => processInfo.pid)).toEqual([401])
      expect(calls).toEqual(["term:401"])
      expect(result.stampFile).toBe(join(homeDir, ".omo", "lsp-daemon", "lsp-proxy-sweep.stamp"))
      expect(existsSync(result.stampFile)).toBe(true)
      expect(existsSync(join(homeDir, ".omo", "codegraph", "zombie-sweep.stamp"))).toBe(false)
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given a fresh proxy family stamp #when sweeping without force #then the proxy family is throttled independently", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-lsp-proxy-throttle-"))
    try {
      const nowMs = Date.UTC(2026, 6, 21, 3, 0, 0)
      await sweepOrphanedLspDaemonProxies({
        force: true,
        homeDir,
        nowMs,
        ownedRoots: ["/tmp/omo-plugin"],
        processProvider: () => Promise.resolve([]),
      })

      // when
      const result = await sweepOrphanedLspDaemonProxies({
        homeDir,
        nowMs: nowMs + 1_000,
        ownedRoots: ["/tmp/omo-plugin"],
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
})

describe("stale lsp-daemon version sweep", () => {
  it("#given a stale attested daemon and a live current daemon #when sweeping #then only the stale daemon is killed", async () => {
    // given (posix-forced: the kill path is platform-gated; a dedicated win32-defer test covers the real-Windows behavior)
    const homeDir = mkdtempSync(join(tmpdir(), "omo-lsp-daemon-sweep-"))
    const baseDir = join(homeDir, ".omo", "lsp-daemon")
    const calls: string[] = []
    try {
      writeOwner(join(baseDir, "v0.0.1"), 710)
      writeOwner(join(baseDir, "v9.9.9"), 711)

      // when
      const result = await sweepStaleLspDaemonVersions({
        platform: "linux",
        attest: (pid) => Promise.resolve(pid === 710 || pid === 711),
        currentVersion: "9.9.9",
        force: true,
        graceMs: 0,
        homeDir,
        isAlive: () => true,
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
      })

      // then
      expect(result.action).toBe("swept")
      expect(result.killed.map((target) => [target.pid, target.version])).toEqual([[710, "0.0.1"]])
      expect(result.candidates.map((target) => target.pid)).toEqual([710])
      expect(calls).toEqual(["term:710"])
      expect(result.stampFile).toBe(join(baseDir, "lsp-daemon-sweep.stamp"))
      expect(existsSync(result.stampFile)).toBe(true)
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given a stale version whose owner pid fails attestation #when sweeping #then it is spared as a possible recycled pid", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-lsp-daemon-spare-"))
    const baseDir = join(homeDir, ".omo", "lsp-daemon")
    const logs: string[] = []
    try {
      writeOwner(join(baseDir, "v0.0.1"), 720)

      // when
      const result = await sweepStaleLspDaemonVersions({
        platform: "linux",
        attest: () => Promise.resolve(false),
        currentVersion: "9.9.9",
        force: true,
        homeDir,
        isAlive: () => true,
        killer: {
          isAlive: () => true,
          kill: () => Promise.resolve(),
          terminate: () => Promise.resolve(),
        },
        log: (message) => logs.push(message),
      })

      // then
      expect(result.killed).toEqual([])
      expect(result.spared.map((target) => target.pid)).toEqual([720])
      expect(logs.some((message) => message.includes("720"))).toBe(true)
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given a stale version on Windows #when sweeping #then it is spared because ownership cannot be proven", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-lsp-daemon-win-"))
    const baseDir = join(homeDir, ".omo", "lsp-daemon")
    try {
      writeOwner(join(baseDir, "v0.0.1"), 730)

      // when
      const result = await sweepStaleLspDaemonVersions({
        currentVersion: "9.9.9",
        force: true,
        homeDir,
        isAlive: () => true,
        platform: "win32",
      })

      // then
      expect(result.killed).toEqual([])
      expect(result.spared.map((target) => [target.pid, target.reason])).toEqual([
        [730, "windows-attestation-unsupported"],
      ])
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given a stale version whose owner pid is dead #when sweeping #then there is nothing to kill", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-lsp-daemon-dead-"))
    const baseDir = join(homeDir, ".omo", "lsp-daemon")
    try {
      writeOwner(join(baseDir, "v0.0.1"), 740)

      // when
      const result = await sweepStaleLspDaemonVersions({
        currentVersion: "9.9.9",
        force: true,
        homeDir,
        isAlive: () => false,
      })

      // then
      expect(result.candidates).toEqual([])
      expect(result.killed).toEqual([])
      expect(result.spared).toEqual([])
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given no current version can be determined #when sweeping #then the family skips conservatively", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-lsp-daemon-unknown-"))
    const baseDir = join(homeDir, ".omo", "lsp-daemon")
    try {
      writeOwner(join(baseDir, "v0.0.1"), 750)

      // when
      const result = await sweepStaleLspDaemonVersions({ env: {}, force: true, homeDir })

      // then
      expect(result.action).toBe("skipped")
      expect(result.killed).toEqual([])
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })

  it("#given non-version entries in the base dir #when sweeping #then they are ignored", async () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-lsp-daemon-entries-"))
    const baseDir = join(homeDir, ".omo", "lsp-daemon")
    try {
      mkdirSync(join(baseDir, "not-a-version"), { recursive: true })
      writeFileSync(join(baseDir, "vfile"), "not a dir")
      writeOwner(join(baseDir, "v0.0.1"), 760)

      // when
      const result = await sweepStaleLspDaemonVersions({
        attest: () => Promise.resolve(true),
        currentVersion: "9.9.9",
        dryRun: true,
        force: true,
        homeDir,
        isAlive: () => true,
      })

      // then
      expect(result.candidates.map((target) => target.version)).toEqual(["0.0.1"])
      expect(result.killed).toEqual([])
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })
})

describe("lsp-daemon cli attestation", () => {
  it("#given a linux /proc cmdline with node cli.js daemon #when attesting #then it passes", async () => {
    // given
    const cmdline = Buffer.from("node\u0000/usr/lib/omo/lsp-daemon/dist/cli.js\u0000daemon\u0000")

    // when / then
    expect(
      await attestLspDaemonCliProcess(801, "linux", { readProcFile: () => Promise.resolve(cmdline) }),
    ).toBe(true)
  })

  it("#given a linux /proc cmdline for the mcp proxy shape #when attesting #then it fails", async () => {
    // given
    const cmdline = Buffer.from("node\u0000/usr/lib/omo/lsp-daemon/dist/cli.js\u0000mcp\u0000")

    // when / then
    expect(
      await attestLspDaemonCliProcess(802, "linux", { readProcFile: () => Promise.resolve(cmdline) }),
    ).toBe(false)
  })

  it("#given an unreadable /proc cmdline #when attesting #then it fails closed", async () => {
    // given / when / then
    expect(
      await attestLspDaemonCliProcess(803, "linux", {
        readProcFile: () => Promise.reject(new Error("ENOENT")),
      }),
    ).toBe(false)
  })

  it("#given a macOS ps command line with node cli.js daemon #when attesting #then it passes", async () => {
    // given / when / then
    expect(
      await attestLspDaemonCliProcess(804, "darwin", {
        executeForStdout: () => Promise.resolve("node /usr/lib/omo/lsp-daemon/dist/cli.js daemon\n"),
      }),
    ).toBe(true)
    expect(
      await attestLspDaemonCliProcess(805, "darwin", {
        executeForStdout: () => Promise.resolve("node /usr/lib/omo/lsp-daemon/dist/cli.js mcp\n"),
      }),
    ).toBe(false)
    expect(await attestLspDaemonCliProcess(806, "darwin", { executeForStdout: () => Promise.resolve(null) })).toBe(false)
  })

  it("#given Windows #when attesting #then it always fails closed", async () => {
    // given / when / then
    expect(await attestLspDaemonCliProcess(807, "win32")).toBe(false)
  })
})

describe("backward-compatible codegraph process-sweep module", () => {
  it("#given the legacy codegraph/process-sweep import path #when importing #then every legacy export is still available", async () => {
    // given / when
    const legacy = await import("./codegraph/process-sweep")

    // then
    expect(typeof legacy.sweepCodegraphZombies).toBe("function")
    expect(typeof legacy.selectZombieCodegraphProcesses).toBe("function")
    expect(typeof legacy.parsePosixProcessTable).toBe("function")
    expect(typeof legacy.parseWindowsProcessTable).toBe("function")
    expect(typeof legacy.discoverCodegraphOwnedRoots).toBe("function")
    expect(typeof legacy.enumerateCodegraphProcesses).toBe("function")
    expect(typeof legacy.createDefaultCodegraphProcessKiller).toBe("function")
    expect(typeof legacy.evaluateDaemonStaleness).toBe("function")
    expect(typeof legacy.parseDaemonLock).toBe("function")
    expect(typeof legacy.daemonLockCandidates).toBe("function")
  })
})
