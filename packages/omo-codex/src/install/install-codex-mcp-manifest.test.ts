/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

const INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS = 20_000

type CachedMcpManifest = {
  readonly mcpServers: {
    readonly ast_grep: { readonly args: readonly string[] }
    readonly context7: { readonly url: string }
    readonly grep_app: { readonly url: string }
  }
}

describe("install-codex MCP manifest", () => {
  test("#given codex installer #when installing omo #then caches research and structural-search MCPs", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-mcp-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-mcp-"))

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot: process.cwd(),
      runCommand: async () => undefined,
    })

    // then
    const pluginPath = result.installed[0]?.path ?? ""
    const manifest = JSON.parse(await readFile(join(pluginPath, ".mcp.json"), "utf8")) as CachedMcpManifest
    const config = await readFile(result.configPath, "utf8")
    expect(manifest.mcpServers.grep_app.url).toBe("https://mcp.grep.app")
    expect(manifest.mcpServers.context7.url).toBe("https://mcp.context7.com/mcp")
    expect(config).not.toContain("[mcp_servers.context7]")
    expect(config).not.toContain("@upstash/context7-mcp")
    expect(manifest.mcpServers.ast_grep.args[0]).toBe(join(pluginPath, "components", "ast-grep-mcp", "dist", "cli.js"))
    expect((await stat(manifest.mcpServers.ast_grep.args[0] ?? "")).isFile()).toBe(true)
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })
})
