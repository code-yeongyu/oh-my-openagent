import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { resolveSenpiLaunch, type SenpiLaunchRuntime } from "./senpi-command"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) =>
  rm(root, { recursive: true, force: true })
)))

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memory-senpi-launch-"))
  roots.push(root)
  return root
}

function runtime(overrides: Partial<SenpiLaunchRuntime> = {}): SenpiLaunchRuntime {
  return {
    isBunBinary: false,
    execPath: process.execPath,
    platform: process.platform,
    argv: [...process.argv],
    resolveInstalledCli: () => null,
    ...overrides,
  }
}

describe("resolveSenpiLaunch", () => {
  test("#given a Windows npm shim #when resolved #then Node launches the adjacent Senpi CLI", async () => {
    // given
    const root = await tempRoot()
    const shim = join(root, "senpi.cmd")
    const cli = join(root, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
    await mkdir(dirname(cli), { recursive: true })
    await writeFile(shim, "@echo off\r\n")
    await writeFile(cli, "console.log('senpi')\n")

    // when
    const launch = resolveSenpiLaunch({ SENPI_BIN: shim, PATH: "" }, runtime({
      platform: "win32",
      execPath: "C:\\node.exe",
    }))

    // then
    expect(launch).toEqual({ command: "C:\\node.exe", prefixArgs: [realpathSync.native(cli)] })
  }, 30_000)

  test("#given no executable but an installed CLI #when resolved #then the current interpreter launches the CLI", async () => {
    // given
    const root = await tempRoot()
    const cli = join(root, "cli.js")
    await writeFile(cli, "console.log('senpi')\n")

    // when
    const launch = resolveSenpiLaunch({ PATH: "" }, runtime({
      resolveInstalledCli: () => cli,
    }))

    // then
    expect(launch).toEqual({ command: process.execPath, prefixArgs: [cli] })
  }, 30_000)

  test("#given package lookup fails in a script-hosted Senpi process #when resolved #then the current entry script is retained", async () => {
    // given
    const root = await tempRoot()
    const entry = join(root, "cli-main.js")
    await writeFile(entry, "console.log('senpi')\n")

    // when
    const launch = resolveSenpiLaunch({ PATH: "" }, runtime({
      argv: [process.execPath, entry],
    }))

    // then
    expect(launch).toEqual({ command: process.execPath, prefixArgs: [entry] })
  }, 30_000)

  test("#given no executable installed CLI or current entry #when resolved #then it fails instead of launching a bare interpreter", () => {
    // given
    const resolve = () => resolveSenpiLaunch({ PATH: "" }, runtime({
      argv: [process.execPath],
    }))

    // when / then
    expect(resolve).toThrow("Unable to resolve a runnable Senpi launcher")
  }, 30_000)

  test("#given the real restricted PATH fallback #when launched #then Senpi prints its version", () => {
    // given
    const node = Bun.which("node")
    if (node === null) throw new Error("node is required")
    const nodeDir = dirname(node)
    const cli = join(import.meta.dir, "..", "..", "..", "..", "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
    const launch = resolveSenpiLaunch({ PATH: nodeDir }, runtime({
      execPath: node,
      resolveInstalledCli: () => cli,
    }))

    // when
    const child = Bun.spawnSync([launch.command, ...launch.prefixArgs, "--version"], {
      env: { ...process.env, PATH: nodeDir },
    })

    // then
    expect(child.exitCode).toBe(0)
    expect(child.stdout.toString().trim()).toMatch(
      /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/,
    )
  }, 30_000)
})
