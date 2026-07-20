import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  parsePosixProcessTable,
  selectZombieCodegraphProcesses,
  discoverCodegraphOwnedRoots,
} from "./codegraph/process-sweep"

describe("CodeGraph zombie process selection", () => {
  it("#given orphaned OMO-owned CodeGraph commands #when selecting zombies #then ppid-one and dead-parent matches are returned", () => {
    // given
    const omoRoot = "/tmp/omo-owned-plugin"
    const orphanedServe = `${process.execPath} ${omoRoot}/components/codegraph/dist/serve.js`
    const deadParentCodegraph = `${process.execPath} ${omoRoot}/node_modules/@colbymchenry/codegraph/bin/codegraph.js serve --mcp`
    const liveParentCodegraph = `${process.execPath} ${omoRoot}/node_modules/@colbymchenry/codegraph/bin/codegraph.js serve --mcp`
    const outsideRoot = `${process.execPath} /tmp/not-omo/node_modules/@colbymchenry/codegraph/bin/codegraph.js serve --mcp`
    const processes = [
      { command: "codex app-server", pid: 200, ppid: 1 },
      { command: orphanedServe, pid: 301, ppid: 1 },
      { command: deadParentCodegraph, pid: 302, ppid: 9999 },
      { command: liveParentCodegraph, pid: 303, ppid: 200 },
      { command: outsideRoot, pid: 304, ppid: 1 },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, { ownedRoots: [omoRoot], platform: "linux" })

    // then
    expect(zombies.map((processInfo) => processInfo.pid)).toEqual([301, 302])
  })

  it("#given a Windows-shaped owned root #when selecting Windows zombies #then platform-specific root resolution is used", () => {
    // given
    const omoRoot = "C:\\Users\\runner\\.codex\\plugins\\cache\\sisyphuslabs\\omo\\4.15.1"
    const processes = [
      {
        command: `${process.execPath} ${omoRoot}\\components\\codegraph\\dist\\serve.js`,
        pid: 305,
        ppid: 1,
      },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, { ownedRoots: [omoRoot], platform: "win32" })

    // then
    expect(zombies.map((processInfo) => processInfo.pid)).toEqual([305])
  })

  it("#given a sibling path shares an OMO root prefix #when selecting zombies #then the sibling is ignored", () => {
    // given
    const omoRoot = "/tmp/omo"
    const siblingRoot = "/tmp/omo-evil"
    const versionRoot = "/tmp/codex/plugins/cache/sisyphuslabs/omo/4.15.1"
    const siblingVersionRoot = "/tmp/codex/plugins/cache/sisyphuslabs/omo/4.15.10"
    const processes = [
      {
        command: `${process.execPath} ${siblingRoot}/node_modules/@colbymchenry/codegraph/bin/codegraph.js serve --mcp`,
        pid: 311,
        ppid: 1,
      },
      {
        command: `${process.execPath} ${siblingVersionRoot}/components/codegraph/dist/serve.js`,
        pid: 312,
        ppid: 1,
      },
      {
        command: `${process.execPath} ${versionRoot}/components/codegraph/dist/serve.js`,
        pid: 313,
        ppid: 1,
      },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, { ownedRoots: [omoRoot, versionRoot], platform: "linux" })

    // then
    expect(zombies.map((processInfo) => processInfo.pid)).toEqual([313])
  })

  it("#given an owned root appears in a different argument #when the upstream binary is outside that root #then it is ignored", () => {
    // given
    const omoRoot = "/tmp/omo"
    const processes = [
      {
        command: [
          process.execPath,
          "/opt/not-omo/node_modules/@colbymchenry/codegraph/bin/codegraph.js",
          "serve",
          "--mcp",
          "--cache",
          omoRoot,
        ].join(" "),
        pid: 321,
        ppid: 1,
      },
      {
        command: `${process.execPath} ${omoRoot}/node_modules/@colbymchenry/codegraph/bin/codegraph.js serve --mcp`,
        pid: 322,
        ppid: 1,
      },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, { ownedRoots: [omoRoot], platform: "linux" })

    // then
    expect(zombies.map((processInfo) => processInfo.pid)).toEqual([322])
  })

  it("#given an upstream package path is only a data argument #when selecting zombies #then it is ignored", () => {
    // given
    const omoRoot = "/tmp/omo"
    const upstreamPath = `${omoRoot}/node_modules/@colbymchenry/codegraph/README.md`
    const processes = [
      {
        command: `/usr/bin/python3 /tmp/tool.py --template ${upstreamPath}`,
        pid: 323,
        ppid: 1,
      },
      {
        command: `${process.execPath} ${omoRoot}/node_modules/@colbymchenry/codegraph/bin/codegraph.js serve --mcp`,
        pid: 324,
        ppid: 1,
      },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, { ownedRoots: [omoRoot], platform: "linux" })

    // then
    expect(zombies.map((processInfo) => processInfo.pid)).toEqual([324])
  })

  it("#given a command only mentions the serve wrapper path #when selecting zombies #then it is ignored", () => {
    // given
    const omoRoot = "/tmp/omo"
    const serveWrapper = `${omoRoot}/components/codegraph/dist/serve.js`
    const processes = [
      {
        command: `/usr/bin/python3 /tmp/tool.py --template ${serveWrapper}`,
        pid: 331,
        ppid: 1,
      },
      {
        command: `${process.execPath} ${serveWrapper}.backup`,
        pid: 332,
        ppid: 1,
      },
      {
        command: `${process.execPath} ${serveWrapper}`,
        pid: 333,
        ppid: 1,
      },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, { ownedRoots: [omoRoot], platform: "linux" })

    // then
    expect(zombies.map((processInfo) => processInfo.pid)).toEqual([333])
  })

  it("#given a POSIX ps table #when parsing process rows #then pid ppid and full command are preserved", () => {
    // given
    const output = [
      "  101     1 /usr/bin/node /tmp/omo/components/codegraph/dist/serve.js",
      "  202   101 /bin/sh -lc echo still includes spaces",
      "not-a-pid line",
    ].join("\n")

    // when
    const parsed = parsePosixProcessTable(output)

    // then
    expect(parsed).toEqual([
      { command: "/usr/bin/node /tmp/omo/components/codegraph/dist/serve.js", pid: 101, ppid: 1 },
      { command: "/bin/sh -lc echo still includes spaces", pid: 202, ppid: 101 },
    ])
  })
})

describe("CodeGraph owned root discovery", () => {
  it("#given Codex plugin cache has OMO under another publisher #when discovering roots #then only sisyphuslabs omo cache is trusted", () => {
    // given
    const codexHome = mkdtempSync(join(tmpdir(), "omo-codegraph-roots-codex-"))
    try {
      const trustedRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "4.15.1")
      const untrustedRoot = join(codexHome, "plugins", "cache", "evil", "omo", "1.0.0")
      mkdirSync(trustedRoot, { recursive: true })
      mkdirSync(untrustedRoot, { recursive: true })

      // when
      const roots = discoverCodegraphOwnedRoots({ codexHome, homeDir: join(codexHome, "home") })

      // then
      expect(roots).toContain(trustedRoot)
      expect(roots).not.toContain(untrustedRoot)
    } finally {
      rmSync(codexHome, { force: true, recursive: true })
    }
  })

  it("#given ambient CODEGRAPH_INSTALL_DIR points outside OMO state #when discovering roots #then it is not trusted", () => {
    // given
    const homeDir = mkdtempSync(join(tmpdir(), "omo-codegraph-roots-home-"))
    try {
      const inheritedInstallDir = "/opt/not-omo"

      // when
      const roots = discoverCodegraphOwnedRoots({
        env: { CODEGRAPH_INSTALL_DIR: inheritedInstallDir },
        homeDir,
      })

      // then
      expect(roots).not.toContain(inheritedInstallDir)
      expect(roots).toContain(join(homeDir, ".omo", "codegraph"))
    } finally {
      rmSync(homeDir, { force: true, recursive: true })
    }
  })
})
