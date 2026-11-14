/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { createInstallSandbox, createPluginFixture, type InstallSandbox } from "./install-test-fixture"
import { localLauncherPath } from "./local-launcher"

const repoRoot = resolve(import.meta.dir, "../../../..")
const tempDirs: string[] = []

// Installs run in a sandbox (#13192, #13253): these temp dirs are inside its root, and it refuses an install whose
// launcher or settings path would land outside.
async function makeTempDir(prefix: string): Promise<string> {
  return sandbox.tempDir(prefix)
}

async function makePluginFixture(): Promise<string> {
  const pluginPath = await createPluginFixture()
  tempDirs.push(pluginPath)
  return pluginPath
}

async function readSettings(agentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>
}

let sandbox: InstallSandbox
beforeEach(async () => {
  sandbox = await createInstallSandbox()
})

afterEach(async () => {
  await sandbox.dispose()
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("runSenpiInstaller local launcher", () => {
  test("#given a sandbox home #when installing #then the launcher is written under that home and reported", async () => {
    // given
    const agentDir = await makeTempDir("omo-senpi-launcher-agent-")
    const homeDir = await makeTempDir("omo-senpi-launcher-home-")
    const pluginPath = await makePluginFixture()

    // when
    const result = await sandbox.install({
      env: { HOME: homeDir, SENPI_CODING_AGENT_DIR: agentDir },
      repoRoot,
      pluginPath,
    })

    // then
    expect(result.launcherPath).toBe(localLauncherPath(homeDir))
    expect(await readFile(localLauncherPath(homeDir), "utf8")).toContain("omo-local-launcher")
  })

  test("#given a foreign omo launcher #when installing #then the plugin is registered and the launcher is left untouched", async () => {
    // given
    const agentDir = await makeTempDir("omo-senpi-launcher-agent-")
    const homeDir = await makeTempDir("omo-senpi-launcher-home-")
    const pluginPath = await makePluginFixture()
    const foreignLauncher = "#!/bin/sh\necho foreign\n"
    await mkdir(join(homeDir, ".local", "bin"), { recursive: true })
    await writeFile(localLauncherPath(homeDir), foreignLauncher)
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["keep-me"] }))

    // when
    const result = await sandbox.install({
      env: { HOME: homeDir, SENPI_CODING_AGENT_DIR: agentDir },
      repoRoot,
      pluginPath,
    })

    // then
    expect(result.launcherPath).toBeUndefined()
    expect(await readSettings(agentDir)).toEqual({ packages: ["keep-me", pluginPath] })
    expect(await readFile(localLauncherPath(homeDir), "utf8")).toBe(foreignLauncher)
  })

  test("#given an installed launcher #when uninstalling #then the launcher under that home is removed", async () => {
    // given
    const agentDir = await makeTempDir("omo-senpi-launcher-agent-")
    const homeDir = await makeTempDir("omo-senpi-launcher-home-")
    const pluginPath = await makePluginFixture()
    const env = { HOME: homeDir, SENPI_CODING_AGENT_DIR: agentDir }
    await sandbox.install({ env, repoRoot, pluginPath })

    // when
    await sandbox.uninstall({ env, repoRoot, pluginPath })

    // then
    await expect(readFile(localLauncherPath(homeDir), "utf8")).rejects.toThrow()
  })
})
