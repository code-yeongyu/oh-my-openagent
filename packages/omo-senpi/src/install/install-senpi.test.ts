/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { runSenpiInstaller, runSenpiUninstaller } from "./install-senpi"

const repoRoot = resolve(import.meta.dir, "../../../..")
const pluginPath = join(repoRoot, "packages", "omo-senpi", "plugin")
const tempDirs: string[] = []

async function makeAgentDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omo-senpi-install-test-"))
  tempDirs.push(dir)
  return dir
}

async function readSettings(agentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as Record<string, unknown>
}

async function backupFiles(agentDir: string): Promise<readonly string[]> {
  return (await readdir(agentDir)).filter((entry) => entry.startsWith("settings.json.") && entry.endsWith(".backup"))
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("runSenpiInstaller", () => {
  test("#given temp SENPI_CODING_AGENT_DIR #when installing twice #then it writes one absolute plugin package entry and creates backups", async () => {
    // given
    const agentDir = await makeAgentDir()
    const env = { SENPI_CODING_AGENT_DIR: agentDir }

    // when
    const first = await runSenpiInstaller({ env, repoRoot })
    const second = await runSenpiInstaller({ env, repoRoot })

    // then
    const settings = await readSettings(agentDir)
    expect(first.agentDir).toBe(agentDir)
    expect(second.pluginPath).toBe(pluginPath)
    expect(settings.packages).toEqual([pluginPath])
    expect(await backupFiles(agentDir)).toHaveLength(2)
  })

  test("#given existing user settings #when installing #then unrelated values are preserved and package entries are deduped", async () => {
    // given
    const agentDir = await makeAgentDir()
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        packages: ["keep-me", "keep-me", pluginPath],
        nested: { enabled: true },
      }),
    )

    // when
    await runSenpiInstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot })

    // then
    const settings = await readSettings(agentDir)
    expect(settings.theme).toBe("dark")
    expect(settings.nested).toEqual({ enabled: true })
    expect(settings.packages).toEqual(["keep-me", pluginPath])
    expect(await backupFiles(agentDir)).toHaveLength(1)
  })
})

describe("runSenpiUninstaller", () => {
  test("#given mixed package settings #when uninstalling #then only the omo-senpi plugin path is removed", async () => {
    // given
    const agentDir = await makeAgentDir()
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        packages: ["keep-me", pluginPath, "also-keep-me", pluginPath],
      }),
    )

    // when
    const result = await runSenpiUninstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot })

    // then
    const settings = await readSettings(agentDir)
    expect(result.removed).toBe(true)
    expect(settings).toEqual({ theme: "dark", packages: ["keep-me", "also-keep-me"] })
    expect(await backupFiles(agentDir)).toHaveLength(1)
  })
})
