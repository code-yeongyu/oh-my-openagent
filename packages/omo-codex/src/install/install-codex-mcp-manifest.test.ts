/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"

const INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS = 30_000

const skipAstGrepInstall = async () => ({ kind: "skipped" as const, reason: "test" })

type CachedMcpManifest = {
  readonly mcpServers: {
    readonly context7: { readonly url: string }
    readonly grep_app: { readonly url: string }
  }
}

describe("install-codex MCP manifest", () => {
  test("#given codex installer #when installing omo #then caches research MCPs without ast-grep MCP", async () => {
    // given
    const codexHome = await mkdtemp(join(tmpdir(), "omo-codex-home-mcp-"))
    const binDir = await mkdtemp(join(tmpdir(), "omo-codex-bin-mcp-"))

    // when
    const result = await runCodexInstaller({
      codexHome,
      binDir,
      repoRoot: process.cwd(),
      astGrepInstaller: skipAstGrepInstall,
      runCommand: async () => undefined,
    })

    // then
    const pluginPath = result.installed[0]?.path ?? ""
    const manifest = JSON.parse(await readFile(join(pluginPath, ".mcp.json"), "utf8")) as CachedMcpManifest
    const config = await readFile(result.configPath, "utf8")
    expect(manifest.mcpServers.grep_app.url).toBe("https://mcp.grep.app")
    expect(manifest.mcpServers.context7.url).toBe("https://mcp.context7.com/mcp")
    expect(Object.hasOwn(manifest.mcpServers, "ast_grep")).toBe(false)
    expect(config).not.toContain("[mcp_servers.context7]")
    expect(config).not.toContain("@upstash/context7-mcp")
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })
})
