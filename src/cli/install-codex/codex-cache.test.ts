/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installCachedPlugin, linkCachedPluginBins, rewriteCachedMcpManifest } from "./codex-cache"

describe("codex-cache", () => {
  test("rewrites cached mcp manifest relative args and cwd", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { lsp: { cwd: ".", args: ["./components/lsp/dist/cli.js", "mcp"] } } }),
    )

    // when
    await rewriteCachedMcpManifest(root)

    // then
    const rewritten = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8")) as {
      mcpServers: { lsp: { cwd?: string; args: string[] } }
    }
    expect(rewritten.mcpServers.lsp.cwd).toBeUndefined()
    expect(rewritten.mcpServers.lsp.args[0]).toBe(join(root, "./components/lsp/dist/cli.js"))
  })

  test("rewrites cached mcp manifest args that point outside the plugin cache back to the source package", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const sourceRoot = join(root, "packages", "omo-codex", "plugin")
    const cacheRoot = join(root, "cache", "omo")
    await mkdir(cacheRoot, { recursive: true })
    await writeFile(
      join(cacheRoot, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          ast_grep: { cwd: ".", args: ["../../ast-grep-mcp/dist/cli.js", "mcp"] },
          custom: { args: ["/usr/local/bin/custom-mcp", "--stdio"] },
          lsp: { cwd: ".", args: ["../../lsp-tools-mcp/dist/cli.js", "mcp"] },
        },
      }),
    )

    // when
    await rewriteCachedMcpManifest(cacheRoot, sourceRoot)

    // then
    const rewritten = JSON.parse(await readFile(join(cacheRoot, ".mcp.json"), "utf8")) as {
      mcpServers: {
        ast_grep: { cwd?: string; args: string[] }
        custom: { args: string[] }
        lsp: { cwd?: string; args: string[] }
      }
    }
    expect(Object.keys(rewritten.mcpServers).sort()).toEqual(["ast_grep", "custom", "lsp"])
    expect(rewritten.mcpServers.ast_grep.cwd).toBeUndefined()
    expect(rewritten.mcpServers.ast_grep.args[0]).toBe(join(root, "packages", "ast-grep-mcp", "dist", "cli.js"))
    expect(rewritten.mcpServers.custom.args).toEqual(["/usr/local/bin/custom-mcp", "--stdio"])
    expect(rewritten.mcpServers.lsp.cwd).toBeUndefined()
    expect(rewritten.mcpServers.lsp.args[0]).toBe(join(root, "packages", "lsp-tools-mcp", "dist", "cli.js"))
  })

  test("rewrites cached package file dependencies that point outside the plugin cache back to the source package", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const codexHome = join(root, "codex-home")
    const sourceRoot = join(root, "packages", "omo-codex", "plugin")
    await mkdir(sourceRoot, { recursive: true })
    await writeFile(
      join(sourceRoot, "package.json"),
      JSON.stringify({
        name: "@scope/omo",
        version: "0.1.0",
        dependencies: { "@scope/lsp-tools": "file:../lsp-tools-mcp" },
      }),
    )

    // when
    const installed = await installCachedPlugin({
      codexHome,
      marketplaceName: "debug",
      name: "omo",
      sourcePath: sourceRoot,
      version: "0.1.0",
      runCommand: async () => undefined,
    })

    // then
    const cachedPackageJson = JSON.parse(await readFile(join(installed.path, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
    }
    expect(cachedPackageJson.dependencies["@scope/lsp-tools"]).toBe(`file:${join(root, "packages", "omo-codex", "lsp-tools-mcp")}`)
  })

  test("links cached plugin bins and stays idempotent", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-hook": "dist/cli.js" } }))
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

    // when
    const first = await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })
    const second = await linkCachedPluginBins({ binDir, pluginRoot, platform: "linux" })

    // then
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    const linkedTarget = await readlink(join(binDir, "omo-hook"))
    expect(linkedTarget).toBe(join(pluginRoot, "dist", "cli.js"))
  })

  test("writes Windows command shims for cached plugin bins", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    await mkdir(pluginRoot, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-hook": "dist/cli.js" } }))
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")

    // when
    const linked = await linkCachedPluginBins({ binDir, pluginRoot, platform: "win32" })

    // then
    expect(linked).toEqual([{ name: "omo-hook", path: join(binDir, "omo-hook.cmd"), target: join(pluginRoot, "dist", "cli.js") }])
    const commandShim = await readFile(join(binDir, "omo-hook.cmd"), "utf8")
    expect(commandShim).toContain("@echo off")
    expect(commandShim).toContain(`node "${join(pluginRoot, "dist", "cli.js")}" %*`)
  })

  test("rejects existing non-generated Windows command shims", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-cache-"))
    const pluginRoot = join(root, "plugin")
    const binDir = join(root, "bin")
    await mkdir(pluginRoot, { recursive: true })
    await mkdir(binDir, { recursive: true })
    await writeFile(join(pluginRoot, "package.json"), JSON.stringify({ name: "@scope/omo", bin: { "omo-hook": "dist/cli.js" } }))
    await mkdir(join(pluginRoot, "dist"), { recursive: true })
    await writeFile(join(pluginRoot, "dist", "cli.js"), "#!/usr/bin/env node\n")
    await writeFile(join(binDir, "omo-hook.cmd"), "@echo off\r\necho custom\r\n")

    // when
    let rejected = false
    try {
      await linkCachedPluginBins({ binDir, pluginRoot, platform: "win32" })
    } catch (error) {
      rejected = error instanceof Error && error.message.includes("already exists and is not a generated command shim")
    }

    // then
    expect(rejected).toBe(true)
    expect(await readFile(join(binDir, "omo-hook.cmd"), "utf8")).toContain("echo custom")
  })
})
