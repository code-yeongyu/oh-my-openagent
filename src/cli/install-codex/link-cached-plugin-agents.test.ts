/// <reference path="../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { linkCachedPluginAgents } from "./link-cached-plugin-agents"

async function makeFixture(): Promise<{ codexHome: string; pluginRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "omo-codex-agents-"))
  const codexHome = join(root, "codex")
  const pluginRoot = join(root, "plugin")
  await mkdir(join(pluginRoot, "components", "ultrawork", "agents"), { recursive: true })
  await mkdir(join(pluginRoot, "components", "ulw-loop", "agents"), { recursive: true })
  await writeFile(
    join(pluginRoot, "components", "ultrawork", "agents", "explorer.toml"),
    'name = "explorer"\n',
  )
  await writeFile(
    join(pluginRoot, "components", "ultrawork", "agents", "librarian.toml"),
    'name = "librarian"\n',
  )
  await writeFile(
    join(pluginRoot, "components", "ulw-loop", "agents", "planner.toml"),
    'name = "planner"\n',
  )
  return { codexHome, pluginRoot }
}

describe("linkCachedPluginAgents", () => {
  test("creates symlinks on linux that point at the bundled TOMLs", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()

    // when
    const linked = await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux" })

    // then
    expect(linked.map((entry) => entry.name).sort()).toEqual([
      "explorer.toml",
      "librarian.toml",
      "planner.toml",
    ])
    for (const entry of linked) {
      const linkStat = await lstat(entry.path)
      expect(linkStat.isSymbolicLink()).toBe(true)
      expect(await readlink(entry.path)).toBe(entry.target)
    }
  })

  test("creates symlinks on darwin (macOS)", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()

    // when
    const linked = await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "darwin" })

    // then
    expect(linked).toHaveLength(3)
    for (const entry of linked) {
      expect((await lstat(entry.path)).isSymbolicLink()).toBe(true)
    }
  })

  test("creates regular file copies on Windows (no symlinks)", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()

    // when
    const linked = await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "win32" })

    // then
    expect(linked).toHaveLength(3)
    for (const entry of linked) {
      const linkStat = await lstat(entry.path)
      expect(linkStat.isSymbolicLink()).toBe(false)
      expect(linkStat.isFile()).toBe(true)
      const content = await readFile(entry.path, "utf8")
      expect(content).toContain(`name = "${entry.name.replace(/\.toml$/, "")}"`)
    }
  })

  test("replaces stale regular files (legacy sync-agents.py copies) with symlinks on unix", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(agentsDir, "explorer.toml"),
      "# stale broken copy with no `name` field, from old sync-agents.py\nmodel = \"old\"\n",
    )

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux" })

    // then
    const linkStat = await lstat(join(agentsDir, "explorer.toml"))
    expect(linkStat.isSymbolicLink()).toBe(true)
    expect(await readlink(join(agentsDir, "explorer.toml"))).toBe(
      join(pluginRoot, "components", "ultrawork", "agents", "explorer.toml"),
    )
  })

  test("overwrites stale copies on Windows", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(join(agentsDir, "explorer.toml"), "# stale broken copy\n")

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "win32" })

    // then
    const content = await readFile(join(agentsDir, "explorer.toml"), "utf8")
    expect(content).toContain('name = "explorer"')
    expect(content).not.toContain("stale broken copy")
  })

  test("writes a manifest under the plugin cache listing installed agent paths for clean uninstall", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux" })

    // then
    const manifestContent = await readFile(join(pluginRoot, ".installed-agents.json"), "utf8")
    const manifest = JSON.parse(manifestContent) as { agents: string[] }
    expect(manifest.agents.sort()).toEqual([
      join(codexHome, "agents", "explorer.toml"),
      join(codexHome, "agents", "librarian.toml"),
      join(codexHome, "agents", "planner.toml"),
    ])
  })

  test("is idempotent across re-runs", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux" })
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux" })
    const linked = await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux" })

    // then
    expect(linked).toHaveLength(3)
    const entries = (await readdir(join(codexHome, "agents"))).sort()
    expect(entries).toEqual(["explorer.toml", "librarian.toml", "planner.toml"])
  })

  test("discovers TOMLs across multiple component agent directories", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()

    // when
    const linked = await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux" })

    // then
    const targets = linked.map((entry) => entry.target).sort()
    expect(targets).toContain(join(pluginRoot, "components", "ultrawork", "agents", "explorer.toml"))
    expect(targets).toContain(join(pluginRoot, "components", "ulw-loop", "agents", "planner.toml"))
  })

  test("returns empty list when plugin has no bundled agents", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-agents-empty-"))
    const codexHome = join(root, "codex")
    const pluginRoot = join(root, "plugin")
    await mkdir(pluginRoot, { recursive: true })

    // when
    const linked = await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux" })

    // then
    expect(linked).toEqual([])
    const manifest = JSON.parse(
      await readFile(join(pluginRoot, ".installed-agents.json"), "utf8"),
    ) as { agents: string[] }
    expect(manifest.agents).toEqual([])
  })

  test("auto-detects host platform when platform parameter is omitted", async () => {
    // given - no `platform` argument, so process.platform decides
    const { codexHome, pluginRoot } = await makeFixture()

    // when
    const linked = await linkCachedPluginAgents({ codexHome, pluginRoot })

    // then - on Unix expect symlinks; on Windows expect file copies
    expect(linked).toHaveLength(3)
    for (const entry of linked) {
      const linkStat = await lstat(entry.path)
      if (process.platform === "win32") {
        expect(linkStat.isSymbolicLink()).toBe(false)
        expect(linkStat.isFile()).toBe(true)
        const content = await readFile(entry.path, "utf8")
        expect(content).toContain(`name = "${entry.name.replace(/\.toml$/, "")}"`)
      } else {
        expect(linkStat.isSymbolicLink()).toBe(true)
      }
    }
  })
})
