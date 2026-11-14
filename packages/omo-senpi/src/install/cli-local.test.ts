/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"

import { createInstallSandbox, createPluginFixture, type InstallSandbox, sandboxSpawnEnv } from "./install-test-fixture"

const repoRoot = resolve(import.meta.dir, "../../../..")
const cliPath = join(repoRoot, "packages", "omo-senpi", "src", "install", "cli-local.ts")
const tempDirs: string[] = []

// The CLI runs in a sandbox (#13192, #13253): the packed plugin is the shared fixture (one required-artifact list),
// and the spawned installer gets an explicit environment whose home and agent dirs are scratch dirs under its root.
let sandbox: InstallSandbox
beforeEach(() => {
  sandbox = createInstallSandbox()
})

async function makeAgentDir(): Promise<string> {
  return sandbox.tempDir("omo-senpi-cli-local-test-")
}

async function makePackagedPlugin(): Promise<string> {
  const pluginPath = await createPluginFixture()
  tempDirs.push(pluginPath)
  await buildInstaller(pluginPath)
  return pluginPath
}

async function buildInstaller(pluginPath: string): Promise<void> {
  await mkdir(join(pluginPath, "scripts"), { recursive: true })
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      cliPath,
      "--target",
      "node",
      "--format",
      "esm",
      "--outfile",
      join(pluginPath, "scripts", "install.mjs"),
    ],
    {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (exitCode !== 0) throw new Error(`installer build failed: ${stdout}${stderr}`)
}

async function runCliLocal(
  action: string,
  agentDir: string,
  pluginPath: string,
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const proc = Bun.spawn(["node", join(pluginPath, "scripts", "install.mjs"), action], {
    cwd: repoRoot,
    env: sandboxSpawnEnv(sandbox.root, sandbox.env, {
      HOME: join(agentDir, "home"),
      USERPROFILE: join(agentDir, "home"),
      OMO_CODING_AGENT_DIR: agentDir,
      SENPI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_DIR: agentDir,
    }),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

// A failing install must be reported by the installer's own line ("missing required runtime artifacts: ..."), which a
// later settings.json read would hide behind ENOENT.
function assertCliResult(result: { exitCode: number; stdout: string; stderr: string }, action: string): void {
  if (result.exitCode !== 0 || !result.stdout.trim().startsWith("{")) {
    throw new Error(
      `${action} failed with exit ${result.exitCode}\nstdout: ${result.stdout.trim()}\nstderr: ${result.stderr.trim()}`,
    )
  }
}

afterEach(async () => {
  await sandbox.dispose()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("cli-local", () => {
  test("#given isolated agent dir #when install then uninstall are invoked #then stdout is one-line JSON and settings round-trip", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePackagedPlugin()

    // when
    const install = await runCliLocal("install", agentDir, pluginPath)

    // then: the installer's own result first, so a refusal is reported by its line, not by a later ENOENT
    assertCliResult(install, "install")
    const installResult = JSON.parse(install.stdout) as { readonly pluginPath: string; readonly launcherPath?: string }
    expect(installResult).toMatchObject({ ok: true, action: "install" })
    expect(install.stdout.trim().split("\n")).toHaveLength(1)

    const installedSettings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as {
      packages?: string[]
    }
    expect(installedSettings.packages).toEqual([installResult.pluginPath])
    expect(installResult.launcherPath).toBe(join(agentDir, "home", ".local", "bin", "omo"))

    const uninstall = await runCliLocal("uninstall", agentDir, pluginPath)
    assertCliResult(uninstall, "uninstall")
    expect(JSON.parse(uninstall.stdout)).toMatchObject({ ok: true, action: "uninstall" })
    expect(uninstall.stdout.trim().split("\n")).toHaveLength(1)
    const uninstalledSettings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as {
      packages?: string[]
    }
    expect(uninstalledSettings.packages).toEqual([])
    await expect(readFile(join(agentDir, "home", ".local", "bin", "omo"), "utf8")).rejects.toThrow()
    expect(install.stderr).toBe("")
  })

  test("#given invalid positional arg #when invoked #then it exits non-zero with one-line JSON error", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePackagedPlugin()

    // when
    const result = await runCliLocal("bogus", agentDir, pluginPath)

    // then
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: expect.stringContaining("install|uninstall") })
    expect(result.stdout.trim().split("\n")).toHaveLength(1)
  })
})
