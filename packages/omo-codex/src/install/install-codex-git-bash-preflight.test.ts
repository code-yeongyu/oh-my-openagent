/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"
import type { CommandRunOptions } from "./types"

const WINDOWS_GIT_BASH_PATH = "C:\\Program Files\\Git\\bin\\bash.exe"
const LSP_CLI_PATH = join(process.cwd(), "packages", "lsp-tools-mcp", "dist", "cli.js")
const INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000

async function withBundledLspRuntimeForTest<T>(run: () => Promise<T>): Promise<T> {
  let lspCliAlreadyPresent = true
  try {
    await stat(LSP_CLI_PATH)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    lspCliAlreadyPresent = false
    await mkdir(join(process.cwd(), "packages", "lsp-tools-mcp", "dist"), { recursive: true })
    await writeFile(LSP_CLI_PATH, "#!/usr/bin/env node\n")
  }

  try {
    return await run()
  } finally {
    if (!lspCliAlreadyPresent) {
      await rm(LSP_CLI_PATH, { force: true })
      await rm(join(process.cwd(), "packages", "lsp-tools-mcp", "dist"), { recursive: true, force: true })
    }
  }
}

describe("install-codex Git Bash preflight", () => {
  test("#given Windows without Git Bash and auto install skip env #when installing Codex profile #then rejects before marketplace or config mutation", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-missing-home-"))
    const repoRoot = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-missing-repo-"))
    const commands: string[] = []

    // when
    const install = runCodexInstaller({
      codexHome,
      repoRoot,
      platform: "win32",
      env: { OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL: "1" },
      gitBashResolver: () => ({
        found: false,
        checkedPaths: [WINDOWS_GIT_BASH_PATH],
        installHint: [
          "Git Bash is required.",
          "winget install --id Git.Git -e --source winget",
          "OMO_CODEX_GIT_BASH_PATH=C:\\path\\to\\bash.exe",
          "rerun `npx lazycodex-ai install`",
        ].join("\n"),
      }),
      runCommand: async (command: string, args: readonly string[], options: CommandRunOptions) => {
        commands.push([command, ...args, options.cwd].join(" "))
      },
    })

    // then
    await expect(install).rejects.toThrow("winget install --id Git.Git -e --source winget")
    expect(commands).toEqual([])
    await expect(stat(join(codexHome, "config.toml"))).rejects.toThrow()
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given Windows without Git Bash #when winget succeeds and resolver recovers #then install continues", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-auto-install-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-auto-install-bin-"))
    const runCalls: string[] = []
    const resolutions = [
      {
        found: false,
        checkedPaths: [WINDOWS_GIT_BASH_PATH],
        installHint: "install hint before winget",
      } as const,
      {
        found: true,
        path: WINDOWS_GIT_BASH_PATH,
        source: "program-files",
      } as const,
    ]
    let resolveCallCount = 0

    // when
    const result = await withBundledLspRuntimeForTest(async () => runCodexInstaller({
      codexHome,
      binDir,
      repoRoot: process.cwd(),
      platform: "win32",
      gitBashResolver: () => resolutions[resolveCallCount++] ?? resolutions[resolutions.length - 1],
      runCommand: async (command: string, args: readonly string[], options: CommandRunOptions) => {
        runCalls.push([command, ...args, options.cwd].join(" "))
      },
    }))

    // then
    expect(runCalls).toContain(`winget install --id Git.Git -e --source winget ${process.cwd()}`)
    expect(resolveCallCount).toBe(2)
    expect(result.gitBashPath).toBe(WINDOWS_GIT_BASH_PATH)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given non-Windows install #when running installer #then winget is never called", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-no-winget-linux-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-no-winget-linux-bin-"))
    const runCalls: string[] = []

    // when
    const result = await withBundledLspRuntimeForTest(async () => runCodexInstaller({
      codexHome,
      binDir,
      repoRoot: process.cwd(),
      platform: "linux",
      gitBashResolver: () => ({ found: true, path: WINDOWS_GIT_BASH_PATH, source: "program-files" }),
      runCommand: async (command: string, args: readonly string[], options: CommandRunOptions) => {
        runCalls.push([command, ...args, options.cwd].join(" "))
      },
    }))

    // then
    expect(result.gitBashPath).toBeNull()
    expect(runCalls.some((command) => command.startsWith("winget "))).toBe(false)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given Windows with Git Bash #when installing Codex profile #then proceeds and reports detected path", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-present-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-present-bin-"))

    // when
    const result = await withBundledLspRuntimeForTest(async () => runCodexInstaller({
      codexHome,
      binDir,
      repoRoot: process.cwd(),
      platform: "win32",
      gitBashResolver: () => ({ found: true, path: WINDOWS_GIT_BASH_PATH, source: "program-files" }),
      runCommand: async () => undefined,
    }))

    // then
    expect(result.gitBashPath).toBe(WINDOWS_GIT_BASH_PATH)
    expect(await readFile(join(codexHome, "config.toml"), "utf8")).toContain("[marketplaces.sisyphuslabs]")
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given Windows env override in installer options #when no custom resolver is provided #then default resolver uses it", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-env-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-env-bin-"))
    const gitBashPath = join(await mkdtemp(join(tmpdir(), "omo-codex-git-bash-env-")), "bash.exe")
    await writeFile(gitBashPath, "")

    // when
    const result = await withBundledLspRuntimeForTest(async () => runCodexInstaller({
      codexHome,
      binDir,
      repoRoot: process.cwd(),
      platform: "win32",
      env: { OMO_CODEX_GIT_BASH_PATH: gitBashPath },
      runCommand: async () => undefined,
    }))

    // then
    expect(result.gitBashPath).toBe(gitBashPath)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })

  test("#given non-Windows install #when Git Bash resolver would fail #then installer keeps existing behavior", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-linux-home-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-linux-bin-"))

    // when
    const result = await withBundledLspRuntimeForTest(async () => runCodexInstaller({
      codexHome,
      binDir,
      repoRoot: process.cwd(),
      platform: "linux",
      gitBashResolver: () => ({
        found: false,
        checkedPaths: [WINDOWS_GIT_BASH_PATH],
        installHint: "should not be used",
      }),
      runCommand: async () => undefined,
    }))

    // then
    expect(result.gitBashPath).toBeNull()
    expect(await readFile(join(codexHome, "config.toml"), "utf8")).toContain("[marketplaces.sisyphuslabs]")
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })
})
