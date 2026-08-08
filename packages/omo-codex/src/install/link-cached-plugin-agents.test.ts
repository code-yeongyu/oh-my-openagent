/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { capturePreservedAgentReasoning, capturePreservedAgentServiceTier, linkCachedPluginAgents } from "./link-cached-plugin-agents"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function makeFixture(): Promise<{ codexHome: string; pluginRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "omo-codex-agents-"))
  temporaryDirectories.push(root)
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
  test("creates regular file copies on linux so agent roles survive snapshot cleanup", async () => {
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
      expect(linkStat.isSymbolicLink()).toBe(false)
      expect(linkStat.isFile()).toBe(true)
    }
    await rm(pluginRoot, { recursive: true, force: true })
    expect(await readFile(join(codexHome, "agents", "explorer.toml"), "utf8")).toBe('name = "explorer"\n')
  })

  test("creates regular file copies on darwin (macOS)", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()

    // when
    const linked = await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "darwin" })

    // then
    expect(linked).toHaveLength(3)
    for (const entry of linked) {
      const linkStat = await lstat(entry.path)
      expect(linkStat.isSymbolicLink()).toBe(false)
      expect(linkStat.isFile()).toBe(true)
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

  test("replaces stale broken symlinks with regular files on unix", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await symlink(join(codexHome, ".tmp", "missing", "explorer.toml"), join(agentsDir, "explorer.toml"))

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux" })

    // then
    const linkStat = await lstat(join(agentsDir, "explorer.toml"))
    expect(linkStat.isSymbolicLink()).toBe(false)
    expect(linkStat.isFile()).toBe(true)
    expect(await readFile(join(agentsDir, "explorer.toml"), "utf8")).toBe('name = "explorer"\n')
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

  test("preserves installed agent reasoning effort when reinstalling file copies", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(pluginRoot, "components", "ulw-loop", "agents", "planner.toml"),
      'name = "planner"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
    )
    await writeFile(
      join(agentsDir, "planner.toml"),
      'name = "planner"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "high"\n',
    )
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux", preservedReasoning })

    // then
    const content = await readFile(join(agentsDir, "planner.toml"), "utf8")
    expect(content).toContain('model_reasoning_effort = "high"')
    expect(content).not.toContain('model_reasoning_effort = "xhigh"')
    expect((await lstat(join(agentsDir, "planner.toml"))).isSymbolicLink()).toBe(false)
  })

  test("ignores malformed installed agent reasoning effort when reinstalling file copies", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(pluginRoot, "components", "ulw-loop", "agents", "planner.toml"),
      'name = "planner"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
    )
    await writeFile(
      join(agentsDir, "planner.toml"),
      'name = "planner"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "high\\q"\n',
    )
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux", preservedReasoning })

    // then
    const content = await readFile(join(agentsDir, "planner.toml"), "utf8")
    expect(content).toContain('model_reasoning_effort = "xhigh"')
    expect(content).not.toContain("high\\q")
  })

  test("preserves removed installed agent service tier when reinstalling file copies", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(pluginRoot, "components", "ulw-loop", "agents", "planner.toml"),
      'name = "planner"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\nservice_tier = "fast"\n',
    )
    await writeFile(
      join(agentsDir, "planner.toml"),
      'name = "planner"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
    )
    const preservedServiceTier = await capturePreservedAgentServiceTier({ codexHome })

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux", preservedServiceTier })

    // then
    const content = await readFile(join(agentsDir, "planner.toml"), "utf8")
    expect(content).not.toContain("service_tier")
    expect((await lstat(join(agentsDir, "planner.toml"))).isSymbolicLink()).toBe(false)
  })

  test("ignores malformed installed agent service tier when reinstalling file copies", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(pluginRoot, "components", "ulw-loop", "agents", "planner.toml"),
      'name = "planner"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\nservice_tier = "fast"\n',
    )
    await writeFile(
      join(agentsDir, "planner.toml"),
      'name = "planner"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\nservice_tier = "flex\\q"\n',
    )
    const preservedServiceTier = await capturePreservedAgentServiceTier({ codexHome })

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux", preservedServiceTier })

    // then
    const content = await readFile(join(agentsDir, "planner.toml"), "utf8")
    expect(content).not.toContain("service_tier")
  })

  test("preserves reviewer reasoning like any other compatibility fixture", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(pluginRoot, "components", "ultrawork", "agents", "lazycodex-gate-reviewer.toml"),
      'name = "lazycodex-gate-reviewer"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "high"\n',
    )
    await writeFile(
      join(agentsDir, "lazycodex-gate-reviewer.toml"),
      'name = "lazycodex-gate-reviewer"\nmodel = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n',
    )
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })

    // when
    await linkCachedPluginAgents({ codexHome, pluginRoot, platform: "linux", preservedReasoning })

    // then
    const content = await readFile(join(agentsDir, "lazycodex-gate-reviewer.toml"), "utf8")
    expect(content).toContain('model_reasoning_effort = "xhigh"')
    expect(content).not.toContain('model_reasoning_effort = "high"')
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
    temporaryDirectories.push(root)
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

  test("applies configured overrides after preserved reasoning and service tier while leaving foreign agents untouched", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    const agentsDir = join(codexHome, "agents")
    await mkdir(agentsDir, { recursive: true })
    await writeFile(
      join(pluginRoot, "components", "ulw-loop", "agents", "planner.toml"),
      'name = "planner"\nmodel = "bundled"\nmodel_reasoning_effort = "medium"\nservice_tier = "standard"\n',
    )
    await writeFile(
      join(agentsDir, "planner.toml"),
      'name = "planner"\nmodel = "installed"\nmodel_reasoning_effort = "low"\nservice_tier = "flex"\n',
    )
    const foreignContent = 'name = "foreign"\nmodel = "do-not-touch"\n'
    await writeFile(join(agentsDir, "foreign.toml"), foreignContent)
    const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })
    const preservedServiceTier = await capturePreservedAgentServiceTier({ codexHome })

    // when
    await linkCachedPluginAgents({
      codexHome,
      pluginRoot,
      platform: "linux",
      preservedReasoning,
      preservedServiceTier,
      agentModelOverrides: new Map([
        ["planner", { model: "openai/gpt-5.6-sol", modelReasoningEffort: "xhigh", serviceTier: "priority" }],
      ]),
    })

    // then
    const content = await readFile(join(agentsDir, "planner.toml"), "utf8")
    expect(content).toContain('model = "openai/gpt-5.6-sol"')
    expect(content).toContain('model_reasoning_effort = "xhigh"')
    expect(content).toContain('service_tier = "priority"')
    expect(content).not.toContain('model_reasoning_effort = "low"')
    expect(content).not.toContain('service_tier = "flex"')
    expect(await readFile(join(agentsDir, "foreign.toml"), "utf8")).toBe(foreignContent)
  })

  test("supports independent model-only reasoning-only and tier-only configured overrides", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()

    // when
    await linkCachedPluginAgents({
      codexHome,
      pluginRoot,
      platform: "linux",
      agentModelOverrides: new Map([
        ["explorer", { model: "openai/gpt-5.6-terra" }],
        ["librarian", { modelReasoningEffort: "high" }],
        ["planner", { serviceTier: "flex" }],
      ]),
    })

    // then
    expect(await readFile(join(codexHome, "agents", "explorer.toml"), "utf8")).toContain(
      'model = "openai/gpt-5.6-terra"',
    )
    expect(await readFile(join(codexHome, "agents", "librarian.toml"), "utf8")).toContain(
      'model_reasoning_effort = "high"',
    )
    expect(await readFile(join(codexHome, "agents", "planner.toml"), "utf8")).toContain(
      'service_tier = "flex"',
    )
  })

  test("replaces non-string duplicate top-level settings exactly once without changing nested same-name keys", async () => {
    // given
    const { codexHome, pluginRoot } = await makeFixture()
    await writeFile(
      join(pluginRoot, "components", "ulw-loop", "agents", "planner.toml"),
      'name = "planner"\nmodel = 17\nmodel = false\nmodel_reasoning_effort = false\nservice_tier = ["fast"]\n\n[tools]\nmodel = 2\nmodel_reasoning_effort = true\nservice_tier = "nested"\n',
    )

    // when
    await linkCachedPluginAgents({
      codexHome,
      pluginRoot,
      platform: "linux",
      agentModelOverrides: new Map([
        ["planner", { model: "openai/gpt-5.6-sol", modelReasoningEffort: "xhigh", serviceTier: "priority" }],
      ]),
    })

    // then
    const content = await readFile(join(codexHome, "agents", "planner.toml"), "utf8")
    const topLevel = content.slice(0, content.indexOf("[tools]"))
    expect(topLevel.match(/^model\s*=/gm)).toHaveLength(1)
    expect(topLevel.match(/^model_reasoning_effort\s*=/gm)).toHaveLength(1)
    expect(topLevel.match(/^service_tier\s*=/gm)).toHaveLength(1)
    expect(content).not.toContain("model = 17")
    expect(content).toContain('[tools]\nmodel = 2\nmodel_reasoning_effort = true\nservice_tier = "nested"')
  })
})
