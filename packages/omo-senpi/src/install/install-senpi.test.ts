/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { runSenpiInstaller, runSenpiUninstaller } from "./install-senpi"

const repoRoot = resolve(import.meta.dir, "../../../..")
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

async function makePluginFixture(options: { readonly runtime?: boolean } = { runtime: true }): Promise<string> {
  const pluginPath = await mkdtemp(join(tmpdir(), "omo-senpi-plugin-fixture-"))
  tempDirs.push(pluginPath)
  await writeFixtureFile(join(pluginPath, "package.json"), JSON.stringify({ name: "@code-yeongyu/omo-senpi" }))
  await writeFixtureFile(join(pluginPath, "extensions", "omo.js"), "export default {}\n")
  await writeFixtureFile(join(pluginPath, "skills", "ultrawork", "SKILL.md"), "# Ultrawork\n")
  await writeFixtureFile(join(pluginPath, "skills", "ulw-loop", "SKILL.md"), "# ULW Loop\n")
  await writeFixtureFile(join(pluginPath, "scripts", "install.mjs"), "#!/usr/bin/env node\n")
  if (options.runtime !== false) {
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "cli.js"), "console.log('cli')\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "index.js"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "index.d.ts"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "daemon-client.js"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "daemon-client.d.ts"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", "package.json"), JSON.stringify({ version: "0.1.0" }))
    await writeFixtureFile(join(pluginPath, "runtime", "lsp-daemon", "dist", ".omo-runtime-manifest.json"), "{}\n")
  }
  return pluginPath
}

async function writeFixtureFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("runSenpiInstaller", () => {
  test("#given temp SENPI_CODING_AGENT_DIR #when installing twice #then it writes one absolute plugin package entry and creates backups", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    const env = { SENPI_CODING_AGENT_DIR: agentDir }

    // when
    const first = await runSenpiInstaller({ env, repoRoot, pluginPath })
    const second = await runSenpiInstaller({ env, repoRoot, pluginPath })

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
    const pluginPath = await makePluginFixture()
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        packages: ["keep-me", "keep-me", pluginPath],
        nested: { enabled: true },
      }),
    )

    // when
    await runSenpiInstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

    // then
    const settings = await readSettings(agentDir)
    expect(settings.theme).toBe("dark")
    expect(settings.nested).toEqual({ enabled: true })
    expect(settings.packages).toEqual(["keep-me", pluginPath])
    expect(await backupFiles(agentDir)).toHaveLength(1)
  })

  test("#given packed plugin missing runtime #when installing #then settings stay unchanged and no backup is written", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture({ runtime: false })
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["keep-me"] }), "utf8")

    // when
    const install = runSenpiInstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

    // then
    await expect(install).rejects.toThrow("missing required runtime artifacts")
    expect(await readSettings(agentDir)).toEqual({ packages: ["keep-me"] })
    expect(await backupFiles(agentDir)).toHaveLength(0)
  })
})

describe("runSenpiUninstaller", () => {
  test("#given mixed package settings #when uninstalling #then only the omo-senpi plugin path is removed", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        theme: "dark",
        packages: ["keep-me", pluginPath, "also-keep-me", pluginPath],
      }),
    )

    // when
    const result = await runSenpiUninstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

    // then
    const settings = await readSettings(agentDir)
    expect(result.removed).toBe(true)
    expect(settings).toEqual({ theme: "dark", packages: ["keep-me", "also-keep-me"] })
    expect(await backupFiles(agentDir)).toHaveLength(1)
  })
})
