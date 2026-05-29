/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { syncLazyclaudecodeMarketplace } from "./sync-lazyclaudecode-marketplace"

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
}

interface PluginFixtureOptions {
  readonly marketplaceName?: string
  readonly pluginName?: string
}

async function writePluginFixture(sourceRoot: string, options: PluginFixtureOptions = {}): Promise<void> {
  const marketplaceName = options.marketplaceName ?? "sisyphuslabs"
  const pluginName = options.pluginName ?? "omo"
  const pluginRoot = join(sourceRoot, "packages", "omo-claude", "plugin")

  await writeJson(join(sourceRoot, "packages", "omo-claude", "marketplace.json"), {
    name: marketplaceName,
    owner: { name: "Yeongyu Kim", url: "https://github.com/code-yeongyu" },
    plugins: [{ name: pluginName, source: "./plugins/omo" }],
  })
  await writeJson(join(pluginRoot, ".claude-plugin", "plugin.json"), {
    name: pluginName,
    version: "1.2.3",
  })

  // Runtime artifacts that MUST be shipped.
  await writeText(join(pluginRoot, "README.md"), "omo\n")
  await writeJson(join(pluginRoot, ".mcp.json"), { mcpServers: {} })
  await writeText(join(pluginRoot, "hooks", "hooks.json"), "{}\n")
  await writeText(join(pluginRoot, "skills", "demo", "SKILL.md"), "# demo\n")
  await writeText(join(pluginRoot, "agents", "planner.md"), "# planner\n")
  await writeText(join(pluginRoot, "components", "rules", "dist", "cli.js"), "// built\n")
  await writeText(join(pluginRoot, "mcp", "ast-grep", "cli.js"), "// mcp\n")

  // Entries that MUST be excluded by the copy filter.
  await writeText(join(pluginRoot, "node_modules", "ignored", "file.txt"), "ignored\n")
  await writeText(join(pluginRoot, "components", "rules", "src", "cli.ts"), "// source\n")
  await writeText(join(pluginRoot, "components", "rules", "tsconfig.build.json"), "{}\n")
  await writeText(join(pluginRoot, "components", "rules", "test", "cli.test.ts"), "// test\n")
  await writeText(join(pluginRoot, "src", "index.ts"), "// source\n")
  await writeText(join(pluginRoot, "test", "smoke.test.ts"), "// test\n")
  await writeText(join(pluginRoot, "tsconfig.json"), "{}\n")
  await writeText(join(pluginRoot, ".omo", "ultragoal", "state.json"), "{}\n")
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

describe("sync-lazyclaudecode-marketplace", () => {
  test("reads .claude-plugin/plugin.json and writes .claude-plugin/marketplace.json into the dest", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-source-"))
    const lazyclaudecodeRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-dest-"))
    await writePluginFixture(sourceRoot)

    // when
    await syncLazyclaudecodeMarketplace({ sourceRoot, lazyclaudecodeRoot })

    // then — destination marketplace at the CC path
    const marketplace = JSON.parse(
      await readFile(join(lazyclaudecodeRoot, ".claude-plugin", "marketplace.json"), "utf8"),
    )
    expect(marketplace.name).toBe("sisyphuslabs")
    expect(marketplace.plugins[0].source).toBe("./plugins/omo")

    // the plugin manifest came from .claude-plugin/plugin.json and landed under plugins/omo
    const manifest = JSON.parse(
      await readFile(join(lazyclaudecodeRoot, "plugins", "omo", ".claude-plugin", "plugin.json"), "utf8"),
    )
    expect(manifest).toMatchObject({ name: "omo", version: "1.2.3" })

    // NOT the codex dest path
    expect(await exists(join(lazyclaudecodeRoot, ".agents", "plugins", "marketplace.json"))).toBe(false)
  })

  test("ships runtime artifacts into plugins/omo", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-source-"))
    const lazyclaudecodeRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-dest-"))
    await writePluginFixture(sourceRoot)

    // when
    await syncLazyclaudecodeMarketplace({ sourceRoot, lazyclaudecodeRoot })

    // then
    const pluginDest = join(lazyclaudecodeRoot, "plugins", "omo")
    expect(await exists(join(pluginDest, ".mcp.json"))).toBe(true)
    expect(await exists(join(pluginDest, "hooks", "hooks.json"))).toBe(true)
    expect(await exists(join(pluginDest, "skills", "demo", "SKILL.md"))).toBe(true)
    expect(await exists(join(pluginDest, "agents", "planner.md"))).toBe(true)
    expect(await exists(join(pluginDest, "components", "rules", "dist", "cli.js"))).toBe(true)
    expect(await exists(join(pluginDest, "mcp", "ast-grep", "cli.js"))).toBe(true)
  })

  test("copy filter excludes node_modules, src/, test/, tsconfig*.json, and .omo/", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-source-"))
    const lazyclaudecodeRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-dest-"))
    await writePluginFixture(sourceRoot)

    // when
    await syncLazyclaudecodeMarketplace({ sourceRoot, lazyclaudecodeRoot })

    // then
    const pluginDest = join(lazyclaudecodeRoot, "plugins", "omo")
    expect(await exists(join(pluginDest, "node_modules"))).toBe(false)
    expect(await exists(join(pluginDest, "src"))).toBe(false)
    expect(await exists(join(pluginDest, "test"))).toBe(false)
    expect(await exists(join(pluginDest, "tsconfig.json"))).toBe(false)
    expect(await exists(join(pluginDest, ".omo"))).toBe(false)
    // nested src/test/tsconfig under a component are excluded too
    expect(await exists(join(pluginDest, "components", "rules", "src"))).toBe(false)
    expect(await exists(join(pluginDest, "components", "rules", "test"))).toBe(false)
    expect(await exists(join(pluginDest, "components", "rules", "tsconfig.build.json"))).toBe(false)
  })

  test("throws when the marketplace name is not sisyphuslabs", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-source-"))
    const lazyclaudecodeRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-dest-"))
    await writePluginFixture(sourceRoot, { marketplaceName: "wrong" })

    // when / then
    await expect(syncLazyclaudecodeMarketplace({ sourceRoot, lazyclaudecodeRoot })).rejects.toThrow("sisyphuslabs")
  })

  test("throws when the plugin name is not omo", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-source-"))
    const lazyclaudecodeRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-dest-"))
    await writePluginFixture(sourceRoot, { pluginName: "not-omo" })

    // when / then
    await expect(syncLazyclaudecodeMarketplace({ sourceRoot, lazyclaudecodeRoot })).rejects.toThrow("omo")
  })

  test("throws when the .claude-plugin/plugin.json manifest is missing", async () => {
    // given
    const sourceRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-source-"))
    const lazyclaudecodeRoot = await mkdtemp(join(tmpdir(), "omo-claude-sync-dest-"))
    await writeJson(join(sourceRoot, "packages", "omo-claude", "marketplace.json"), {
      name: "sisyphuslabs",
      plugins: [{ name: "omo", source: "./plugins/omo" }],
    })

    // when / then
    await expect(syncLazyclaudecodeMarketplace({ sourceRoot, lazyclaudecodeRoot })).rejects.toThrow(
      ".claude-plugin/plugin.json",
    )
  })
})
