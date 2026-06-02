/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { syncLazycodexMarketplace } from "./sync-lazycodex-marketplace"

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writePluginFixture(sourceRoot: string): Promise<void> {
  await writeJson(join(sourceRoot, "packages", "omo-codex", "marketplace.json"), {
    name: "sisyphuslabs",
    plugins: [{ name: "omo", source: "./plugins/omo" }],
  })
  await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"), {
    name: "omo",
    version: "1.2.3",
  })
  await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", ".mcp.json"), {
    mcpServers: {
      ast_grep: { command: "node", args: ["../../ast-grep-mcp/dist/cli.js", "mcp"], cwd: "." },
      git_bash: { command: "node", args: ["../../git-bash-mcp/dist/cli.js", "mcp"], cwd: "." },
      lsp: { command: "node", args: ["../../lsp-tools-mcp/dist/cli.js", "mcp"], cwd: "." },
    },
  })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "README.md"), "omo\n")
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "lsp", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "components", "lsp", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "ast-grep-mcp", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "ast-grep-mcp", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "git-bash-mcp", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "git-bash-mcp", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "lsp-tools-mcp", "dist"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "lsp-tools-mcp", "dist", "cli.js"), "#!/usr/bin/env node\n")
  await mkdir(join(sourceRoot, "packages", "omo-codex", "plugin", "node_modules", "ignored"), { recursive: true })
  await writeFile(join(sourceRoot, "packages", "omo-codex", "plugin", "node_modules", "ignored", "file.txt"), "ignored\n")
}

describe("sync-lazycodex-marketplace", () => {
  test("#given marketplace sync #when copying plugin bundle #then emits self-contained mcp paths", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-lazycodex-"))
    await writePluginFixture(sourceRoot)

    // when
    await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })

    // then
    const marketplace = JSON.parse(await readFile(join(lazycodexRoot, ".agents", "plugins", "marketplace.json"), "utf8"))
    expect(marketplace.name).toBe("sisyphuslabs")
    expect(marketplace.plugins[0].source).toBe("./plugins/omo")
    const manifest = JSON.parse(await readFile(join(lazycodexRoot, "plugins", "omo", ".codex-plugin", "plugin.json"), "utf8"))
    expect(manifest).toMatchObject({ name: "omo", version: "1.2.3" })
    const mcpManifest = JSON.parse(await readFile(join(lazycodexRoot, "plugins", "omo", ".mcp.json"), "utf8"))
    expect(mcpManifest.mcpServers.ast_grep.args[0]).toBe("./components/ast-grep-mcp/dist/cli.js")
    expect(mcpManifest.mcpServers.git_bash.args[0]).toBe("./components/git-bash-mcp/dist/cli.js")
    expect(mcpManifest.mcpServers.lsp.args[0]).toBe("./components/lsp-tools-mcp/dist/cli.js")
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "components", "ast-grep-mcp", "dist", "cli.js"))).isFile()).toBe(true)
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "components", "git-bash-mcp", "dist", "cli.js"))).isFile()).toBe(true)
    expect((await stat(join(lazycodexRoot, "plugins", "omo", "components", "lsp-tools-mcp", "dist", "cli.js"))).isFile()).toBe(true)
    let nodeModulesMissing = false
    try {
      await stat(join(lazycodexRoot, "plugins", "omo", "node_modules"))
    } catch (error) {
      nodeModulesMissing = error instanceof Error
    }
    expect(nodeModulesMissing).toBe(true)
  })

  test("rejects a source tree without a Codex plugin manifest", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-bad-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-bad-lazycodex-"))
    await writeJson(join(sourceRoot, "packages", "omo-codex", "marketplace.json"), {
      name: "sisyphuslabs",
      plugins: [{ name: "omo", source: "./plugins/omo" }],
    })

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing Codex plugin manifest")
  })

  test("#given stale mcp runtime path #when syncing marketplace #then rejects the broken bundle", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-stale-mcp-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-stale-mcp-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", ".mcp.json"), {
      mcpServers: {
        lsp: { command: "node", args: ["./components/lsp/packages/lsp-tools-mcp/dist/cli.js", "mcp"], cwd: "." },
      },
    })

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing MCP runtime path")
    expect(message).toContain("components/lsp/packages/lsp-tools-mcp/dist/cli.js")
  })

  test("#given missing hook command target #when syncing marketplace #then rejects the broken bundle", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-sync-missing-hook-source-"))
    const lazycodexRoot = await mkdtemp(join(tmpdir(), "omo-sync-missing-hook-lazycodex-"))
    await writePluginFixture(sourceRoot)
    await writeJson(join(sourceRoot, "packages", "omo-codex", "plugin", "hooks", "hooks.json"), {
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: "node \"${PLUGIN_ROOT}/components/rules/dist/cli.js\" hook session-start",
              },
            ],
          },
        ],
      },
    })

    // when
    let message = ""
    try {
      await syncLazycodexMarketplace({ sourceRoot, lazycodexRoot })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(message).toContain("missing hook command target")
    expect(message).toContain("components/rules/dist/cli.js")
  })
})
