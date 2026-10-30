import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { PassThrough } from "node:stream"

import { windowsTreeKillArgs } from "../../../memory-core/src/concurrency/windows-process-tree.mjs"
import { npmPackStage, resolveNpm, runBoundedStage } from "./bounded-stage.test-support.mjs"

// Stand-in for a packaging stage that stalls, with a child of its own like a shell-launched tool (#10911).
const STALLED_WITH_CHILD = [
  "const { spawn } = require('node:child_process')",
  "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
  "console.log(`CHILD ${child.pid}`)",
  "setInterval(() => {}, 1000)",
].join("\n")

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe("runBoundedStage (#10911)", () => {
  test("#given a stage that finishes #when it runs #then its status and output are returned", async () => {
    const result = await runBoundedStage("echo", process.execPath, ["-e", "console.log('done')"], {}, 20_000)
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe("done")
  })

  test.skipIf(process.platform !== "win32")("#given a stage that stalls with a child #when its cap passes #then it fails naming the stage and its child is gone too", async () => {
    const failure = await runBoundedStage("stalled stage", process.execPath, ["-e", STALLED_WITH_CHILD], {}, 2_000).catch((error) => error)
    expect(String(failure?.message)).toContain("stalled stage did not finish within 2000 ms")
    const childPid = Number(String(failure?.message).match(/CHILD (\d+)/)?.[1])
    expect(Number.isSafeInteger(childPid)).toBe(true)
    expect(alive(childPid)).toBe(false)
  }, 30_000)

  test.skipIf(process.platform === "win32")("#given a stage that stalls #when its cap passes #then it fails naming the stage with its output", async () => {
    const failure = await runBoundedStage("stalled stage", process.execPath, ["-e", "console.log('started'); setInterval(() => {}, 1000)"], {}, 2_000).catch((error) => error)
    expect(String(failure?.message)).toContain("stalled stage did not finish within 2000 ms")
    expect(String(failure?.message)).toContain("started")
  }, 30_000)
})

function isInside(parent, child) {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

// A simulated filesystem: the files that exist, and the links realpath follows.
function fakeFs(files, links = {}) {
  const present = new Set(files)
  return { isFile: (path) => present.has(path), realpath: (path) => links[path] ?? path }
}

const POSIX_CLI = "/opt/node/lib/node_modules/npm/bin/npm-cli.js"
const WINDOWS_CLI = "C:\\node\\node_modules\\npm\\bin\\npm-cli.js"

describe("resolveNpm (#10911)", () => {
  test.each([
    {
      name: "npm on PATH linked to npm-cli.js with its own node beside it #then that node runs it",
      platform: "linux", pathValue: "/a:/b",
      fs: fakeFs(["/b/npm", "/b/node", "/opt/node/bin/node"], { "/b/npm": POSIX_CLI }),
      expected: { node: "/opt/node/bin/node", cli: POSIX_CLI },
    },
    {
      name: "npm on PATH linked to npm-cli.js with no node beside it #then the node on PATH runs it, as npm's shebang would",
      platform: "linux", pathValue: "/b",
      fs: fakeFs(["/b/npm", "/b/node"], { "/b/npm": POSIX_CLI }),
      expected: { node: "/b/node", cli: POSIX_CLI },
    },
    {
      name: "npm on PATH that is a wrapper script #then the npm bundled with the node on PATH runs under that node",
      platform: "linux", pathValue: "/wrap:/usr/local/bin",
      fs: fakeFs(["/wrap/npm", "/usr/local/bin/node", "/opt/node-24/bin/node", "/opt/node-24/lib/node_modules/npm/bin/npm-cli.js"], {
        "/usr/local/bin/node": "/opt/node-24/bin/node",
      }),
      expected: { node: "/opt/node-24/bin/node", cli: "/opt/node-24/lib/node_modules/npm/bin/npm-cli.js" },
    },
    {
      name: "npm and node that are both version-manager shims with no bundled npm #then nothing is resolved",
      platform: "linux", pathValue: "/shims",
      fs: fakeFs(["/shims/npm", "/shims/node", "/home/u/.volta/bin/volta-shim"], {
        "/shims/npm": "/home/u/.volta/bin/volta-shim",
        "/shims/node": "/home/u/.volta/bin/volta-shim",
      }),
      expected: null,
    },
    {
      name: "no npm and no node on PATH #then nothing is resolved",
      platform: "linux", pathValue: "/empty", fs: fakeFs([]), expected: null,
    },
    {
      name: "Windows npm.cmd with npm-cli.js and node.exe beside it #then that node.exe runs it, as npm.cmd would",
      platform: "win32", pathValue: "C:\\tools;C:\\node",
      fs: fakeFs(["C:\\node\\npm.cmd", "C:\\node\\node.exe", WINDOWS_CLI]),
      expected: { node: "C:\\node\\node.exe", cli: WINDOWS_CLI },
    },
    {
      name: "Windows npm.cmd shim with no npm-cli.js beside it #then the npm bundled with the node.exe on Path is used",
      platform: "win32", pathValue: "C:\\shim;C:\\node",
      fs: fakeFs(["C:\\shim\\npm.cmd", "C:\\node\\node.exe", WINDOWS_CLI]),
      expected: { node: "C:\\node\\node.exe", cli: WINDOWS_CLI },
    },
    {
      name: "Windows with no npm-cli.js anywhere #then nothing is resolved",
      platform: "win32", pathValue: "C:\\shim", fs: fakeFs(["C:\\shim\\npm.cmd", "C:\\shim\\node.exe"]), expected: null,
    },
  ])("#given $name", ({ platform, pathValue, fs, expected }) => {
    expect(resolveNpm({ platform, pathValue, ...fs })).toEqual(expected)
  })
})

describe("npmPackStage (#10911)", () => {
  const work = join(tmpdir(), "omo-sync-sidecar-pack-spec")
  const pkg = join(work, "pkg")
  const npm = { node: "/opt/node/bin/node", cli: POSIX_CLI }
  const resolvedArgs = ["--single-threaded", POSIX_CLI, "pack", pkg, "--silent", "--pack-destination", work]
  const shimArgs = ["pack", pkg, "--silent", "--pack-destination", work]
  test.each([
    { name: "a resolved npm on POSIX", platform: "linux", npm, command: npm.node, args: resolvedArgs, shell: false },
    { name: "a resolved npm on Windows", platform: "win32", npm, command: npm.node, args: resolvedArgs, shell: false },
    { name: "no resolved npm on POSIX", platform: "linux", npm: null, command: "npm", args: shimArgs, shell: false },
    { name: "no resolved npm on Windows, where npm.cmd needs cmd.exe", platform: "win32", npm: null, command: "npm", args: shimArgs, shell: true },
  ])("#given $name #when the stage is built #then it runs the expected command from outside the scratch dir", ({ platform, npm: resolved, command, args, shell }) => {
    const stage = npmPackStage(pkg, work, { npm: resolved, platform })
    expect(stage.command).toBe(command)
    expect(stage.args).toEqual(args)
    expect(Boolean(stage.options.shell)).toBe(shell)
    expect(isInside(work, stage.options.cwd)).toBe(false)
  })

  test("#given the npm pack stage #when it runs a stand-in npm that ends with process.exit #then that node ran single-threaded outside the scratch dir", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "omo-npm-pack-stage-"))
    try {
      const cli = join(scratch, "npm-cli.js")
      await writeFile(cli, "console.log(JSON.stringify({ execArgv: process.execArgv, cwd: process.cwd() })); process.exit(0)\n")
      const stage = npmPackStage(join(scratch, "pkg"), scratch, { npm: { node: "node", cli } })
      const result = await runBoundedStage("npm pack", stage.command, stage.args, stage.options, 20_000)
      expect(result.status, result.stderr).toBe(0)
      const seen = JSON.parse(result.stdout.trim())
      expect(seen.execArgv).toContain("--single-threaded")
      expect(isInside(scratch, seen.cwd)).toBe(false)
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }, 30_000)

  test("#given simulated Windows #when the npm pack stage stalls after printing its tarball #then taskkill targets the one node process it spawned", async () => {
    const npmOnWindows = { node: "C:\\node\\node.exe", cli: WINDOWS_CLI }
    const stage = npmPackStage("C:\\work\\pkg", "C:\\work", { npm: npmOnWindows, platform: "win32", cwd: "C:\\" })
    const selfPid = 100
    // The process list Windows reports for this stage: its node is a direct child of the test process, no cmd.exe between.
    const processRows = [`${selfPid} 1 10 bun.exe`, `4242 ${selfPid} 20 node.exe`].join("\n")
    const child = Object.assign(new EventEmitter(), { pid: 4242, stdout: new PassThrough(), stderr: new PassThrough() })
    const spawned = []
    const killed = []
    const failure = await runBoundedStage("npm pack", stage.command, stage.args, stage.options, 50, {
      platform: "win32",
      spawnChild: (command, args, options) => {
        spawned.push({ command, args, options })
        child.stdout.write("code-yeongyu-omo-senpi-5.1.49.tgz\n")
        return child
      },
      treeKillArgs: (pid) => windowsTreeKillArgs(pid, () => ({ status: 0, stdout: processRows }), selfPid),
      runSync: (command, args) => {
        killed.push([command, ...args])
        child.emit("close", null)
      },
    }).catch((error) => error)
    expect(spawned.map(({ command, args }) => [command, ...args])).toEqual([[npmOnWindows.node, ...stage.args]])
    expect(spawned[0].options.shell).toBeFalsy()
    expect(killed).toEqual([["taskkill", "/F", "/PID", "4242"]])
    expect(String(failure?.message)).toContain("npm pack did not finish within 50 ms; stdout: code-yeongyu-omo-senpi-5.1.49.tgz")
  })
})
