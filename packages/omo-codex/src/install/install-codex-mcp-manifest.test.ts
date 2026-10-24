/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCodexInstaller } from "./install-codex"
import { createRepoWithBuiltComponentBins } from "./install-codex-test-fixtures"

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

    const repoRoot = await createRepoWithBuiltComponentBins({ includeBundledGitBashMcp: true })

    try {
      // Exercise the shipped manifest without copying unrelated skill and runtime payloads.
      await copyFile(
        join(import.meta.dir, "../../plugin/.mcp.json"),
        join(repoRoot, "packages/omo-codex/plugin/.mcp.json"),
      )
      await mkdir(join(repoRoot, "packages/lsp-daemon/dist"), { recursive: true })
      await writeFile(join(repoRoot, "packages/lsp-daemon/dist/cli.js"), "#!/usr/bin/env node\n")

      // when
      const result = await runCodexInstaller({
        codexHome,
        binDir,
        repoRoot,
        projectDirectory: repoRoot,
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
    } finally {
      await Promise.all([repoRoot, codexHome, binDir].map((path) => rm(path, { recursive: true, force: true })))
    }
  }, { timeout: INSTALL_CODEX_INTEGRATION_TEST_TIMEOUT_MS })
})
