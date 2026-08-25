/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
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
  await writeFixtureFile(join(pluginPath, "extensions", "omo-task.js"), "export const createTaskComponent = () => ({})\n")
  await writeFixtureFile(join(pluginPath, "extensions", "omo-member.js"), "export default {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "memory-run-supervisor.mjs"), "export {}\n")
  await writeFixtureFile(join(pluginPath, "extensions", "reflection-persona.md"), "# reflection persona fixture\n")
  await writeFixtureFile(join(pluginPath, "extensions", "dream-persona.md"), "# dream persona fixture\n")
  await writeFixtureFile(join(pluginPath, "extensions", "facts-persona.md"), "# facts persona fixture\n")
  const requiredSkillNames = [
    "ast-grep",
    "coding-agent-sessions",
    "debugging",
    "frontend",
    "git-master",
    "init-deep",
    "lsp-setup",
    "programming",
    "refactor",
    "remove-ai-slops",
    "review-work",
    "ultimate-browsing",
    "ultrawork",
    "ulw-execute",
    "ulw-loop",
    "ulw-plan",
    "ulw-research",
    "visual-qa",
  ]
  for (const skillName of requiredSkillNames) {
    await writeFixtureFile(join(pluginPath, "skills", skillName, "SKILL.md"), `# ${skillName}\n`)
  }
  await writeFixtureFile(join(pluginPath, "scripts", "install.mjs"), "#!/usr/bin/env node\n")
  if (options.runtime !== false) {
    const astGrepRuntime = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js")
    await writeFixtureFile(astGrepRuntime, "console.log('ast-grep')\n")
    await chmod(astGrepRuntime, 0o755)
    const astGrepRuntimeBytes = await readFile(astGrepRuntime)
    await writeFixtureFile(
      join(pluginPath, "runtime", "ast-grep-mcp", "manifest.json"),
      `${JSON.stringify({
        sha256: createHash("sha256").update(astGrepRuntimeBytes).digest("hex"),
        mode: 0o755,
        stagedAtUtc: "2026-08-03T00:00:00.000Z",
      }, null, 2)}\n`,
    )
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "cli.js"), "export {}\n")
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "ulw-loop", "cli.js"), "console.log('ulw-loop')\n")
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "omo-agent-toolkit"), "#!/bin/sh\n")
    await writeFixtureFile(join(pluginPath, "runtime", "agent-toolkit", "omo-agent-toolkit.cmd"), "@echo off\r\n")
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

  test("#given legacy goal and webfetch packages #when installing #then builtin-shadowing entries are removed", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    const legacyGoal = join(repoRoot, "packages", "pi-goal")
    const legacyWebfetch = join(repoRoot, "packages", "pi-webfetch")
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        packages: [
          "keep-me",
          relative(agentDir, legacyGoal),
          legacyWebfetch,
          pluginPath,
        ],
      }),
    )

    // when
    await runSenpiInstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

    // then
    const settings = await readSettings(agentDir)
    expect(settings.packages).toEqual(["keep-me", pluginPath])
  })

  test("#given a Windows packed runtime with a POSIX manifest mode #when installing #then matching content passes integrity", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    const runtimeEntry = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js")
    await chmod(runtimeEntry, 0o700)

    // when
    const result = await runSenpiInstaller({
      env: { SENPI_CODING_AGENT_DIR: agentDir },
      repoRoot,
      pluginPath,
      platform: "win32",
    })

    // then
    expect(result.ok).toBe(true)
    expect(await readSettings(agentDir)).toEqual({ packages: [pluginPath] })
  })

  test("#given a POSIX packed runtime with a mismatched manifest mode #when installing #then integrity fails", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    const runtimeEntry = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js")
    await chmod(runtimeEntry, 0o700)

    // when
    const install = runSenpiInstaller({
      env: { SENPI_CODING_AGENT_DIR: agentDir },
      repoRoot,
      pluginPath,
      platform: "linux",
    })

    // then
    await expect(install).rejects.toThrow("mode mismatch: manifest=493 actual=")
  })

  test("#given packed ast-grep runtime differs from its manifest #when installing #then integrity failure leaves settings unchanged", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    const runtimeEntry = join(pluginPath, "runtime", "ast-grep-mcp", "cli.js")
    const original = await readFile(runtimeEntry)
    await writeFixtureFile(
      join(pluginPath, "runtime", "ast-grep-mcp", "manifest.json"),
      `${JSON.stringify({
        sha256: createHash("sha256").update(original).digest("hex"),
        mode: 0o755,
        stagedAtUtc: "2026-08-03T00:00:00.000Z",
      }, null, 2)}\n`,
    )
    await writeFile(runtimeEntry, "#!/usr/bin/env node\nthrow new Error('corrupted runtime')\n", "utf8")
    await chmod(runtimeEntry, 0o755)
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["keep-me"] }), "utf8")

    // when
    const install = runSenpiInstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

    // then
    await expect(install).rejects.toThrow("ast-grep MCP runtime integrity error")
    expect(await readSettings(agentDir)).toEqual({ packages: ["keep-me"] })
    expect(await backupFiles(agentDir)).toHaveLength(0)
  })

  test("#given packed ast-grep runtime missing its manifest #when installing #then integrity failure leaves settings unchanged", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    await rm(join(pluginPath, "runtime", "ast-grep-mcp", "manifest.json"))
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["keep-me"] }), "utf8")

    // when
    const install = runSenpiInstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

    // then
    await expect(install).rejects.toThrow("ast-grep MCP runtime integrity error")
    expect(await readSettings(agentDir)).toEqual({ packages: ["keep-me"] })
    expect(await backupFiles(agentDir)).toHaveLength(0)
  })

  test("#given a packed plugin missing the run supervisor #when installing #then artifact validation fails before settings change", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    await rm(join(pluginPath, "extensions", "memory-run-supervisor.mjs"))
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["keep-me"] }), "utf8")

    // when
    const install = runSenpiInstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

    // then
    await expect(install).rejects.toThrow("missing required runtime artifacts")
    expect(await readSettings(agentDir)).toEqual({ packages: ["keep-me"] })
    expect(await backupFiles(agentDir)).toHaveLength(0)
  })

  test("#given a packed plugin missing the dream persona #when installing #then artifact validation fails before settings change", async () => {
    // given
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    await rm(join(pluginPath, "extensions", "dream-persona.md"))
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: ["keep-me"] }), "utf8")

    // when
    const install = runSenpiInstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

    // then
    await expect(install).rejects.toThrow("missing required runtime artifacts")
    expect(await readSettings(agentDir)).toEqual({ packages: ["keep-me"] })
    expect(await backupFiles(agentDir)).toHaveLength(0)
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

  test("#given packed plugin missing the lazy task runtime #when installing #then settings stay unchanged", async () => {
    const agentDir = await makeAgentDir()
    const pluginPath = await makePluginFixture()
    await rm(join(pluginPath, "extensions", "omo-task.js"))

    const install = runSenpiInstaller({ env: { SENPI_CODING_AGENT_DIR: agentDir }, repoRoot, pluginPath })

    await expect(install).rejects.toThrow("missing required runtime artifacts")
    await expect(readFile(join(agentDir, "settings.json"), "utf8")).rejects.toThrow()
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
