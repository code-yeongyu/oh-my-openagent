import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { checkCodex, gatherCodexSummary } from "./codex"

async function createPlatformBin(binDir: string, name: string, target: string): Promise<void> {
  if (process.platform === "win32") {
    await writeFile(join(binDir, `${name}.cmd`), `@echo off\r\nnode "${target}" %*\r\n`)
    return
  }

  await symlink(target, join(binDir, name))
}

async function createInstalledCodexHome(): Promise<{ readonly codexHome: string; readonly binDir: string; readonly pluginRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "omo-codex-doctor-"))
  const codexHome = join(root, ".codex")
  const binDir = join(root, "bin")
  const pluginRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo", "0.1.0")
  await mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true })
  await mkdir(join(codexHome, ".tmp", "marketplaces", "sisyphuslabs", "plugins", "omo"), { recursive: true })
  await mkdir(join(codexHome, "agents"), { recursive: true })
  await mkdir(binDir, { recursive: true })
  await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "omo", version: "0.1.0" }))
  await writeFile(join(pluginRoot, "lazycodex-install.json"), JSON.stringify({ packageName: "lazycodex-ai", version: "4.7.5" }))
  await writeFile(
    join(codexHome, "config.toml"),
    [
      "[features]",
      "plugins = true",
      "plugin_hooks = true",
      "",
      "[marketplaces.sisyphuslabs]",
      `source = "${join(codexHome, "plugins", "cache", "sisyphuslabs")}"`,
      "",
      '[plugins."omo@sisyphuslabs"]',
      "enabled = true",
      "",
      "[agents.plan]",
      'config_file = "./agents/plan.toml"',
      "",
    ].join("\n"),
  )
  await writeFile(join(codexHome, "agents", "plan.toml"), 'name = "plan"\n')
  await createPlatformBin(binDir, "omo", join(pluginRoot, "dist", "cli.js"))
  await createPlatformBin(binDir, "omo-rules", join(pluginRoot, "components", "rules", "dist", "cli.js"))
  return { codexHome, binDir, pluginRoot }
}

describe("codex doctor checks", () => {
  test("#given installed LazyCodex cache and config #when gathering Codex summary #then reports package and plugin versions", async () => {
    // given
    const { codexHome, binDir, pluginRoot } = await createInstalledCodexHome()

    // when
    const summary = await gatherCodexSummary({
      codexHome,
      binDir,
      detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    })

    // then
    expect(summary.codexPath).toBe("/usr/local/bin/codex")
    expect(summary.marketplaceName).toBe("sisyphuslabs")
    expect(summary.pluginName).toBe("omo")
    expect(summary.pluginVersion).toBe("0.1.0")
    expect(summary.packageName).toBe("lazycodex-ai")
    expect(summary.packageVersion).toBe("4.7.5")
    expect(summary.pluginRoot).toBe(pluginRoot)
    expect(summary.config.pluginEnabled).toBe(true)
    expect(summary.config.pluginsFeatureEnabled).toBe(true)
    expect(summary.config.pluginHooksFeatureEnabled).toBe(true)
    expect(summary.linkedBins).toEqual(["omo", "omo-rules"])
  })

  test("#given missing Codex config #when checking Codex doctor #then fails with install guidance", async () => {
    // given
    const root = await mkdtemp(join(tmpdir(), "omo-codex-doctor-missing-"))
    const codexHome = join(root, ".codex")

    // when
    const result = await checkCodex({
      codexHome,
      binDir: join(root, "bin"),
      detectCodexInstallation: async () => ({ found: false, checkedPaths: ["codex (PATH)"], hint: "Install Codex" }),
    })

    // then
    expect(result.status).toBe("fail")
    expect(result.issues.map((issue) => issue.title)).toContain("Codex is not installed")
    expect(result.issues.map((issue) => issue.title)).toContain("OMO Codex plugin is not installed")
    expect(result.issues.map((issue) => issue.title)).toContain("Codex plugin is not enabled")
    expect(result.issues.map((issue) => issue.title)).toContain("LazyCodex marketplace is not configured")
  })

  test("#given another plugin is enabled #when LazyCodex is disabled #then Codex doctor reports OMO as disabled", async () => {
    // given
    const { codexHome, binDir } = await createInstalledCodexHome()
    await writeFile(
      join(codexHome, "config.toml"),
      [
        "[features]",
        "plugins = true",
        "plugin_hooks = true",
        "",
        "[marketplaces.sisyphuslabs]",
        `source = "${join(codexHome, "plugins", "cache", "sisyphuslabs")}"`,
        "",
        '[plugins."omo@sisyphuslabs"]',
        "enabled = false",
        "",
        '[plugins."other@example"]',
        "enabled = true",
      ].join("\n"),
    )

    // when
    const result = await checkCodex({
      codexHome,
      binDir,
      detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    })

    // then
    expect(result.status).toBe("fail")
    expect(result.issues.map((issue) => issue.title)).toContain("Codex plugin is not enabled")
  })

  test("#given LazyCodex marketplace is missing #when Codex doctor runs #then plugin loading fails", async () => {
    // given
    const { codexHome, binDir } = await createInstalledCodexHome()
    await writeFile(
      join(codexHome, "config.toml"),
      [
        "[features]",
        "plugins = true",
        "plugin_hooks = true",
        "",
        '[plugins."omo@sisyphuslabs"]',
        "enabled = true",
      ].join("\n"),
    )

    // when
    const result = await checkCodex({
      codexHome,
      binDir,
      detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    })

    // then
    expect(result.status).toBe("fail")
    expect(result.issues.map((issue) => issue.title)).toContain("LazyCodex marketplace is not configured")
  })

  test("#given installed LazyCodex #when checking Codex doctor #then details include Codex-specific health surfaces", async () => {
    // given
    const { codexHome, binDir } = await createInstalledCodexHome()

    // when
    const result = await checkCodex({
      codexHome,
      binDir,
      detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    })

    // then
    expect(result.status).toBe("pass")
    expect(result.details).toContain("Codex: /usr/local/bin/codex")
    expect(result.details).toContain("Marketplace: sisyphuslabs")
    expect(result.details).toContain("Plugin: omo@0.1.0")
    expect(result.details).toContain("Distribution: lazycodex-ai@4.7.5")
    expect(result.details).toContain("Enabled plugin: omo@sisyphuslabs")
    expect(result.details).toContain("Linked bins: omo, omo-rules")
    expect(result.details).toContain("Agents: plan")
  })

  test("#given malformed lazycodex install snapshot #when gathering Codex summary #then does not crash", async () => {
    // given
    const { codexHome, binDir, pluginRoot } = await createInstalledCodexHome()
    await writeFile(join(pluginRoot, "lazycodex-install.json"), "{not-json")

    // when
    const summary = await gatherCodexSummary({
      codexHome,
      binDir,
      detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    })

    // then
    expect(summary.packageName).toBeNull()
    expect(summary.packageVersion).toBeNull()
  })

  test("#given installed LazyCodex #when reading config directly #then fixture is a real TOML-like file", async () => {
    // given
    const { codexHome } = await createInstalledCodexHome()

    // when
    const content = await readFile(join(codexHome, "config.toml"), "utf8")

    // then
    expect(content).toContain('[plugins."omo@sisyphuslabs"]')
  })
})
