/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { runSenpiInstaller, runSenpiUninstaller } from "./install-senpi"
import { createPluginFixture } from "./install-test-fixture"
import { localLauncherPath } from "./local-launcher"

const repoRoot = resolve(import.meta.dir, "../../../..")
const tempDirs: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

async function makePluginFixture(): Promise<string> {
  const pluginPath = await createPluginFixture()
  tempDirs.push(pluginPath)
  return pluginPath
}

async function readSettings(agentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("runSenpiInstaller local launcher", () => {
  test("#given a sandbox home #when installing #then the launcher is written under that home and reported", async () => {
    // given
    const agentDir = await makeTempDir("omo-senpi-launcher-agent-")
    const homeDir = await makeTempDir("omo-senpi-launcher-home-")
    const pluginPath = await makePluginFixture()

    // when
    const result = await runSenpiInstaller({ env: { HOME: homeDir, SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

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
    const result = await runSenpiInstaller({ env: { HOME: homeDir, SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

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
    await runSenpiInstaller({ env, repoRoot, pluginPath })

    // when
    await runSenpiUninstaller({ env, repoRoot, pluginPath })

    // then
    await expect(readFile(localLauncherPath(homeDir), "utf8")).rejects.toThrow()
  })
})
