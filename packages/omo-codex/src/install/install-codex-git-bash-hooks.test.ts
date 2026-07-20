/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

const INSTALL_CODEX_GIT_BASH_TEST_TIMEOUT_MS = process.platform === "win32" ? 60_000 : 20_000
const GIT_BASH_PRE_TOOL_USE_HOOK = "./hooks/pre-tool-use-recommending-git-bash-mcp.json"
const GIT_BASH_POST_COMPACT_HOOK = "./hooks/post-compact-resetting-git-bash-mcp-reminder.json"

const skipAstGrepInstall = async () => ({ kind: "skipped" as const, reason: "test" })

describe("install-codex Git Bash hooks", () => {
  test("#given simulated Windows Codex install #when installing omo #then enables git_bash MCP and trusts shell hooks", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-git-bash-win-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-git-bash-win-"))
    const repoRoot = process.cwd()

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      platform: "win32",
      astGrepInstaller: skipAstGrepInstall,
      gitBashResolver: () => ({ found: true, path: "C:\\Program Files\\Git\\bin\\bash.exe", source: "program-files" }),
      runCommand: async () => undefined,
    })

    // then
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toContain('[plugins."omo@sisyphuslabs".mcp_servers.git_bash]')
    expect(configContent).toContain("enabled = true")
    expect(configContent).toContain(GIT_BASH_PRE_TOOL_USE_HOOK.slice(2))
    expect(configContent).toContain(GIT_BASH_POST_COMPACT_HOOK.slice(2))
    expect(result.gitBashPath).toBe("C:\\Program Files\\Git\\bin\\bash.exe")
    const pluginPath = result.installed[0]?.path ?? ""
    const hooks = await readInstalledPluginHooks(pluginPath)
    expect(hooks).toContain(GIT_BASH_PRE_TOOL_USE_HOOK)
    expect(hooks).toContain(GIT_BASH_POST_COMPACT_HOOK)
    const gitBashMcpPath = await readGitBashMcpPath(pluginPath)
    expect(gitBashMcpPath).toBe(join(pluginPath, "components", "git-bash-mcp", "dist", "cli.js"))
    expect((await stat(gitBashMcpPath)).isFile()).toBe(true)
  }, { timeout: INSTALL_CODEX_GIT_BASH_TEST_TIMEOUT_MS })

  test("#given simulated Linux Codex install #when installing omo #then keeps git_bash MCP disabled without registering shell reminder hooks", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-git-bash-linux-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-git-bash-linux-"))
    const repoRoot = process.cwd()

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot,
      platform: "linux",
      astGrepInstaller: skipAstGrepInstall,
      runCommand: async () => undefined,
    })

    // then
    const configContent = await readFile(join(codexHome, "config.toml"), "utf8")
    expect(configContent).toContain('[plugins."omo@sisyphuslabs".mcp_servers.git_bash]')
    expect(configContent).toContain("enabled = false")
    expect(configContent).not.toContain(GIT_BASH_PRE_TOOL_USE_HOOK.slice(2))
    expect(configContent).not.toContain(GIT_BASH_POST_COMPACT_HOOK.slice(2))
    const pluginPath = result.installed[0]?.path ?? ""
    const hooks = await readInstalledPluginHooks(pluginPath)
    expect(hooks).not.toContain(GIT_BASH_PRE_TOOL_USE_HOOK)
    expect(hooks).not.toContain(GIT_BASH_POST_COMPACT_HOOK)
    expect(await readGitBashMcpPath(pluginPath)).toBe(join(pluginPath, "components", "git-bash-mcp", "dist", "cli.js"))
  }, { timeout: INSTALL_CODEX_GIT_BASH_TEST_TIMEOUT_MS })
})

async function readInstalledPluginHooks(pluginPath: string): Promise<readonly string[]> {
  const parsed: unknown = JSON.parse(await readFile(join(pluginPath, ".codex-plugin", "plugin.json"), "utf8"))
  if (!isRecord(parsed) || !Array.isArray(parsed.hooks)) return []
  return parsed.hooks.filter((hook): hook is string => typeof hook === "string")
}

async function readGitBashMcpPath(pluginPath: string): Promise<string> {
  const parsed: unknown = JSON.parse(await readFile(join(pluginPath, ".mcp.json"), "utf8"))
  if (!isRecord(parsed) || !isRecord(parsed.mcpServers)) return ""
  const gitBash = parsed.mcpServers.git_bash
  if (!isRecord(gitBash) || !Array.isArray(gitBash.args)) return ""
  const [entrypoint] = gitBash.args
  return typeof entrypoint === "string" ? entrypoint : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
