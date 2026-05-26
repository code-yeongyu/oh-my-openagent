import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { linkCachedPluginBins, rewriteCachedMcpManifest } from "./codex-cache"

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
    const first = await linkCachedPluginBins({ binDir, pluginRoot })
    const second = await linkCachedPluginBins({ binDir, pluginRoot })

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
})
