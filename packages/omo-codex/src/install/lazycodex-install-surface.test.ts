/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"
import { createRepoWithBuiltComponentBins, EXPECTED_OMO_COMPONENT_BINS, expectedBinName } from "./install-codex-test-fixtures"

const STALE_CODEX_COMPONENT_BINS = [
  "codex-comment-checker",
  "codex-rules",
  "codex-start-work-continuation",
  "codex-telemetry",
  "codex-ultrawork",
] as const

const LAZYCODEX_AGENT_ROLE_NAMES = [
  "lazycodex-clone-fidelity-reviewer",
  "lazycodex-code-reviewer",
  "lazycodex-executor",
  "lazycodex-gate-reviewer",
  "lazycodex-qa-executor",
] as const

const INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS = 20_000

describe("lazycodex install surface", () => {
  test("#given codex installer #when installing omo #then exposes durable LazyCodex agent roles", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-lazycodex-agents-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-lazycodex-agents-"))

    // when
    await runCodexInstaller({ codexHome, binDir, repoRoot: process.cwd(), runCommand: async () => undefined })

    // then
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    for (const agentName of LAZYCODEX_AGENT_ROLE_NAMES) {
      expect(configContent).toContain(`[agents.${agentName}]`)
      expect(configContent).toContain(`config_file = "./agents/${agentName}.toml"`)
      const agentFile = join(codexHome, "agents", `${agentName}.toml`)
      expect((await stat(agentFile)).isFile()).toBe(true)
      expect(await readFile(agentFile, "utf8")).toContain(`name = "${agentName}"`)
    }
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given codex installer #when installing omo #then links documented component binaries to cached runtimes", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-bins-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-bins-"))
    const repoRoot = await createRepoWithBuiltComponentBins()

    // when
    const result = await runCodexInstaller({ codexHome, binDir, repoRoot, runCommand: async () => undefined })

    // then
    const pluginPath = result.installed[0]?.path ?? ""
    const linkedNames = (await readdir(binDir)).sort()
    expect(linkedNames).toEqual(EXPECTED_OMO_COMPONENT_BINS.map((entry) => expectedBinName(entry.name)).sort())
    for (const entry of EXPECTED_OMO_COMPONENT_BINS) {
      const linkPath = join(binDir, expectedBinName(entry.name))
      if ("kind" in entry && entry.kind === "runtime-wrapper") {
        const expectedTarget = join(repoRoot, entry.target)
        expect((await stat(linkPath)).isFile()).toBe(true)
        const wrapper = await readFile(linkPath, "utf8")
        expect(wrapper).toContain("OMO_GENERATED_RUNTIME_WRAPPER")
        expect(wrapper).toContain(expectedTarget)
        expect(wrapper).toContain("CODEX_HOME")
        expect(wrapper).toContain("OMO_SPARKSHELL_APP_SERVER_SOCKET")
        expect(wrapper).toContain("omo-ulw-loop")
        expect(wrapper).toContain("bun runtime not found")
        expect(wrapper).toContain("https://bun.sh")
      } else if (process.platform === "win32") {
        const expectedTarget = join(pluginPath, entry.target)
        expect((await stat(linkPath)).isFile()).toBe(true)
        expect(await readFile(linkPath, "utf8")).toContain(expectedTarget)
      } else {
        const expectedTarget = join(pluginPath, entry.target)
        expect(await readlink(linkPath)).toBe(expectedTarget)
        expect((await stat(expectedTarget)).isFile()).toBe(true)
      }
    }
    for (const staleName of STALE_CODEX_COMPONENT_BINS) {
      expect(linkedNames).not.toContain(staleName)
      expect(linkedNames).not.toContain(`${staleName}.cmd`)
    }
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given installation guide #when component binaries and LazyCodex roles are documented #then docs match install surface", async () => {
    // given
    const installationGuide = await readFile(join(process.cwd(), "docs", "guide", "installation.md"), "utf8")

    // when
    const componentBinNames = EXPECTED_OMO_COMPONENT_BINS.map((entry) => entry.name)

    // then
    for (const name of componentBinNames) {
      expect(installationGuide).toContain(name)
    }
    for (const staleName of STALE_CODEX_COMPONENT_BINS) {
      expect(installationGuide).not.toContain(`~/.local/bin/${staleName}`)
      expect(installationGuide).not.toContain(`command not found: ${staleName}`)
    }
    expect(installationGuide).toContain("~/.codex/agents/{")
    expect(installationGuide).toContain("}.toml")
    for (const agentName of LAZYCODEX_AGENT_ROLE_NAMES) {
      expect(installationGuide).toContain(agentName)
    }
  })

  test("#given Codex prunes an old plugin cache version #when LazyCodex roles were installed #then roles still resolve from Codex home", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-autoupdate-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-autoupdate-"))
    const marketplaceRoot = join(codexHome, ".tmp", "marketplaces", "sisyphuslabs")
    await mkdir(join(marketplaceRoot, ".git"), { recursive: true })
    await writeFile(join(marketplaceRoot, ".git", "config"), "[remote \"origin\"]\n")
    await writeFile(join(marketplaceRoot, ".codex-marketplace-install.json"), '{"source_type":"git"}\n')

    // when
    const result = await runCodexInstaller({ codexHome, binDir, repoRoot: process.cwd(), runCommand: async () => undefined })
    const pluginPath = result.installed[0]?.path
    if (pluginPath === undefined) {
      throw new Error("Codex installer did not report an installed plugin path")
    }
    await rm(pluginPath, { recursive: true, force: true })

    // then
    const agentName = "lazycodex-gate-reviewer"
    const agentPath = join(codexHome, "agents", `${agentName}.toml`)
    const snapshotAgentPath = join(marketplaceRoot, "plugins", "omo", "components", "ultrawork", "agents", `${agentName}.toml`)
    expect((await stat(agentPath)).isFile()).toBe(true)
    expect(await readFile(agentPath, "utf8")).toBe(await readFile(snapshotAgentPath, "utf8"))
    expect(await readFile(agentPath, "utf8")).toContain(`name = "${agentName}"`)
    expect(await readFile(join(marketplaceRoot, ".git", "config"), "utf8")).toBe("[remote \"origin\"]\n")
    expect(await readFile(join(marketplaceRoot, ".codex-marketplace-install.json"), "utf8")).toBe(
      '{"source_type":"git"}\n',
    )
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given Codex temporary marketplace snapshot is removed #when LazyCodex roles were installed #then roles still resolve from Codex home", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-clean-snapshot-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-clean-snapshot-"))

    // when
    await runCodexInstaller({ codexHome, binDir, repoRoot: process.cwd(), runCommand: async () => undefined })
    await rm(join(codexHome, ".tmp", "marketplaces", "sisyphuslabs"), { recursive: true, force: true })
    await rm(join(codexHome, "plugins", "cache", "sisyphuslabs"), { recursive: true, force: true })

    // then
    const agentName = "lazycodex-code-reviewer"
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toContain(`config_file = "./agents/${agentName}.toml"`)
    expect(await readFile(join(codexHome, "agents", `${agentName}.toml`), "utf8")).toContain(`name = "${agentName}"`)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })
})
