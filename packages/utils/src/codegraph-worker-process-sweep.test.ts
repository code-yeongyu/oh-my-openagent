import { describe, expect, it } from "bun:test"
import { join, resolve } from "node:path"

import { discoverCodegraphOwnedRoots, selectZombieCodegraphProcesses } from "./codegraph/process-sweep"

describe("CodeGraph worker process selection", () => {
  it("#given quoted real-world POSIX worker commands #when selecting zombies #then platform and provisioned workers are matched", () => {
    // given
    const claudeRoot = "/Users/yeongyu/.claude/omo"
    const provisionedRoot = "/Users/yeongyu/.omo/codegraph"
    const processes = [
      {
        command: `${claudeRoot}/node_modules/@colbymchenry/codegraph-darwin-arm64/node --liftoff-only ${claudeRoot}/node_modules/@colbymchenry/codegraph-darwin-arm64/lib/dist/bin/codegraph.js status --json`,
        pid: 92635,
        ppid: 1,
      },
      {
        command: `${provisionedRoot}/node --liftoff-only ${provisionedRoot}/lib/dist/bin/codegraph.js status --json`,
        pid: 93383,
        ppid: 1,
      },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, {
      ownedRoots: [claudeRoot, provisionedRoot],
      platform: "darwin",
    })

    // then
    expect(zombies.map((processInfo) => [processInfo.pid, processInfo.matchKind])).toEqual([
      [92635, "upstream-codegraph"],
      [93383, "upstream-codegraph"],
    ])
  })

  it("#given an orphaned npm shim still owns a platform child #when selecting zombies #then the whole worker family is selected", () => {
    // given
    const root = "/Users/yeongyu/.claude/omo"
    const processes = [
      {
        command: `node ${root}/node_modules/@colbymchenry/codegraph/npm-shim.js status --json`,
        pid: 94100,
        ppid: 1,
      },
      {
        command: `${root}/node_modules/@colbymchenry/codegraph-darwin-arm64/node --liftoff-only ${root}/node_modules/@colbymchenry/codegraph-darwin-arm64/lib/dist/bin/codegraph.js status --json`,
        pid: 94101,
        ppid: 94100,
      },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, { ownedRoots: [root], platform: "darwin" })

    // then
    expect(zombies.map((processInfo) => processInfo.pid)).toEqual([94100, 94101])
  })

  it("#given a live worker owns npm-shim and platform children #when selecting zombies #then none of its family is condemned", () => {
    // given
    const root = "/Users/yeongyu/.claude/omo"
    const processes = [
      { command: `node ${root}/components/codegraph/dist/cli.js hook session-start-worker`, pid: 94200, ppid: 200 },
      { command: `node ${root}/node_modules/@colbymchenry/codegraph/npm-shim.js sync`, pid: 94201, ppid: 94200 },
      {
        command: `${root}/node_modules/@colbymchenry/codegraph-darwin-arm64/node --liftoff-only ${root}/node_modules/@colbymchenry/codegraph-darwin-arm64/lib/dist/bin/codegraph.js sync`,
        pid: 94202,
        ppid: 94201,
      },
      { command: "codex app-server", pid: 200, ppid: 1 },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, { ownedRoots: [root], platform: "darwin" })

    // then
    expect(zombies).toEqual([])
  })

  it("#given Windows platform and provisioned worker commands #when selecting zombies #then both shapes are matched", () => {
    // given
    const pluginRoot = "C:\\Users\\runner\\.codex\\plugins\\cache\\sisyphuslabs\\omo\\4.19.2"
    const provisionedRoot = "C:\\Users\\runner\\.omo\\codegraph"
    const platformRoot = `${pluginRoot}\\node_modules\\@colbymchenry\\codegraph-win32-x64`
    const processes = [
      {
        command: `${platformRoot}\\node.exe --liftoff-only ${platformRoot}\\lib\\dist\\bin\\codegraph.js status --json`,
        pid: 95100,
        ppid: 1,
      },
      {
        command: `${provisionedRoot}\\node.exe --liftoff-only ${provisionedRoot}\\lib\\dist\\bin\\codegraph.js index`,
        pid: 95101,
        ppid: 1,
      },
    ]

    // when
    const zombies = selectZombieCodegraphProcesses(processes, {
      ownedRoots: [pluginRoot, provisionedRoot],
      platform: "win32",
    })

    // then
    expect(zombies.map((processInfo) => processInfo.pid)).toEqual([95100, 95101])
  })

  it("#given the default home roots #when discovering owned roots #then the Claude OMO install is included", () => {
    // given
    const homeDir = "/Users/yeongyu"

    // when
    const roots = discoverCodegraphOwnedRoots({ codexHome: join(homeDir, ".missing-codex"), homeDir })

    // then
    expect(roots).toContain(resolve(homeDir, ".claude", "omo"))
  })

  it("#given a detached provisioned daemon #when selecting zombies #then daemon classification remains intact", () => {
    // given
    const root = "/Users/yeongyu/.omo/codegraph"
    const projectRoot = "/tmp/live-project"
    const command = `${root}/node --liftoff-only ${root}/lib/dist/bin/codegraph.js serve --mcp --path ${projectRoot}`

    // when
    const zombies = selectZombieCodegraphProcesses([{ command, pid: 95200, ppid: 1 }], {
      ownedRoots: [root],
      platform: "darwin",
    })

    // then
    expect(zombies.map(({ daemonProjectRoot, matchKind }) => ({ daemonProjectRoot, matchKind }))).toEqual([
      { daemonProjectRoot: projectRoot, matchKind: "upstream-daemon" },
    ])
  })
})
