import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { resolveSenpiLaunch, type SenpiLaunchRuntime, withoutForeignPackageDirEnv } from "./senpi-command"

// Windows resolution scans PATH for `senpi.exe`; an extension-less `senpi` there is an npm shim,
// not an executable, so a fixture using the POSIX name proves nothing about the PATH branch.
const SENPI_BINARY = process.platform === "win32" ? "senpi.exe" : "senpi"

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
    isCompiledEngine: false,
    execPath: process.execPath,
    platform: process.platform,
    argv: [...process.argv],
    resolveInstalledCli: () => null,
    ...overrides,
  }
}

describe("withoutForeignPackageDirEnv", () => {
  test("#given a launcher outside the package root #when the child env is built #then the package-dir variables are dropped", () => {
    // given: the omo binary exports its own root, but the child resolves to a separate npm install
    const engineRoot = join("/opt", "omo-runtime")
    const env = {
      OMO_PACKAGE_DIR: engineRoot,
      SENPI_PACKAGE_DIR: engineRoot,
      PATH: "/usr/bin",
    }

    // when
    const next = withoutForeignPackageDirEnv(env, {
      command: "/usr/local/bin/bun",
      prefixArgs: [join("/home", "u", ".bun", "install", "global", "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")],
    })

    // then
    expect(next.OMO_PACKAGE_DIR).toBeUndefined()
    expect(next.SENPI_PACKAGE_DIR).toBeUndefined()
    expect(next.PATH).toBe("/usr/bin")
  })

  test("#given the embedded engine as launcher #when the child env is built #then the package-dir variables survive", () => {
    // given
    const engineRoot = join("/opt", "omo-runtime")
    const env = { OMO_PACKAGE_DIR: engineRoot, SENPI_PACKAGE_DIR: engineRoot }

    // when
    const next = withoutForeignPackageDirEnv(env, { command: join(engineRoot, "omo"), prefixArgs: [] })

    // then
    expect(next.OMO_PACKAGE_DIR).toBe(engineRoot)
    expect(next.SENPI_PACKAGE_DIR).toBe(engineRoot)
  })

  test("#given no package-dir variables #when the child env is built #then the environment is unchanged", () => {
    // given
    const env = { PATH: "/usr/bin" }

    // when
    const next = withoutForeignPackageDirEnv(env, { command: "/usr/local/bin/senpi", prefixArgs: [] })

    // then
    expect(next).toEqual({ PATH: "/usr/bin" })
  })
})

describe("resolveSenpiLaunch", () => {
  test("#given the running engine is a compiled omo binary and PATH carries a senpi #when resolved #then the child is that same binary", async () => {
    // given: the binary embeds the engine; the PATH senpi is a different install with its own assets
    const root = await tempRoot()
    const execPath = join(root, "omo")
    const foreign = join(root, "path", SENPI_BINARY)
    await mkdir(dirname(foreign), { recursive: true })
    await writeFile(execPath, "")
    await writeFile(foreign, "")

    // when
    const launch = resolveSenpiLaunch({ PATH: dirname(foreign) }, runtime({ isCompiledEngine: true, execPath }))

    // then
    expect(launch).toEqual({ command: realpathSync.native(execPath), prefixArgs: [] })
  }, 30_000)

  test("#given a compiled omo binary with no senpi on PATH, no installed CLI and no entry script #when resolved #then it still launches itself", async () => {
    // given
    const root = await tempRoot()
    const execPath = join(root, "omo")
    await writeFile(execPath, "")

    // when
    const launch = resolveSenpiLaunch({ PATH: "" }, runtime({ isCompiledEngine: true, execPath, argv: [execPath] }))

    // then
    expect(launch).toEqual({ command: realpathSync.native(execPath), prefixArgs: [] })
  }, 30_000)

  test("#given a script-hosted engine and a senpi on PATH #when resolved #then the PATH senpi is still chosen", async () => {
    // given: the non-compiled parent keeps today's resolution order
    const root = await tempRoot()
    const onPath = join(root, "path", SENPI_BINARY)
    await mkdir(dirname(onPath), { recursive: true })
    await writeFile(onPath, "")

    // when
    const launch = resolveSenpiLaunch({ PATH: dirname(onPath) }, runtime())

    // then
    expect(launch).toEqual({ command: realpathSync.native(onPath), prefixArgs: [] })
  }, 30_000)

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
