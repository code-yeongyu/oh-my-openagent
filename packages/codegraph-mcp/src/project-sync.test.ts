import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createProjectSynchronizer } from "./project-sync.js"
import type { CodegraphCommandResult } from "./types.js"

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("CodeGraph project synchronizer", () => {
  test("#given a fresh initial repository #when initialized #then status and init finish before readiness", async () => {
    const projectRoot = tempDirectory("omo-codegraph-sync-init-")
    const calls: string[][] = []
    const synchronizer = createProjectSynchronizer({
      command: { argsPrefix: [], command: "/bin/codegraph" },
      env: {},
      homeDir: tempDirectory("omo-codegraph-sync-home-"),
      run: (_cwd, _command, args) => {
        calls.push([...args])
        return Promise.resolve(result(args[0] === "status" ? '{"initialized":false}' : ""))
      },
    })

    await synchronizer.initialize(projectRoot, true)

    expect(calls).toEqual([["status", "--json"], ["init"]])
  })

  test("#given an indexed secondary repository #when a nested projectPath is refreshed #then its graph syncs", async () => {
    const projectRoot = tempDirectory("omo-codegraph-sync-secondary-")
    const nested = join(projectRoot, "src", "nested")
    mkdirSync(join(projectRoot, ".codegraph"), { recursive: true })
    mkdirSync(nested, { recursive: true })
    const calls: Array<{ readonly args: readonly string[]; readonly cwd: string }> = []
    const synchronizer = createProjectSynchronizer({
      command: { argsPrefix: [], command: "/bin/codegraph" },
      env: {},
      homeDir: tempDirectory("omo-codegraph-sync-home-"),
      run: (cwd, _command, args) => {
        calls.push({ args: [...args], cwd })
        return Promise.resolve(result(args[0] === "status" ? '{"initialized":true}' : ""))
      },
    })

    const refreshed = await synchronizer.refresh(nested, true)

    expect(refreshed).toBe(true)
    expect(calls).toEqual([
      { args: ["status", "--json"], cwd: projectRoot },
      { args: ["sync"], cwd: projectRoot },
    ])
  })

  test("#given an unindexed secondary repository #when refreshed with auto-init #then it initializes before use", async () => {
    const projectRoot = tempDirectory("omo-codegraph-sync-secondary-fresh-")
    const calls: string[][] = []
    const synchronizer = createProjectSynchronizer({
      command: { argsPrefix: [], command: "/bin/codegraph" },
      env: {},
      homeDir: tempDirectory("omo-codegraph-sync-home-"),
      run: (_cwd, _command, args) => {
        calls.push([...args])
        return Promise.resolve(result(args[0] === "status" ? '{"initialized":false}' : ""))
      },
    })

    const refreshed = await synchronizer.refresh(projectRoot, true)

    expect(refreshed).toBe(true)
    expect(calls).toEqual([["status", "--json"], ["init"]])
  })
})

function result(stdout: string): CodegraphCommandResult {
  return { exitCode: 0, stderr: "", stdout, timedOut: false }
}

function tempDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}
