import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { checkCodex, gatherCodexSummary } from "./codex"
import { checkCodexRuntimeWrapper } from "./codex-runtime-wrapper"

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
  await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "omo", version: "4.7.5" }))
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
    expect(summary.pluginVersion).toBe("4.7.5")
    expect(summary.pluginVersionStamped).toBe(true)
    expect(summary.packageName).toBe("lazycodex-ai")
    expect(summary.packageVersion).toBe("4.7.5")
    expect(summary.pluginRoot).toBe(pluginRoot)
    expect(summary.config.pluginEnabled).toBe(true)
    expect(summary.config.pluginsFeatureEnabled).toBe(true)
    expect(summary.config.pluginHooksFeatureEnabled).toBe(true)
    expect(summary.config.companionPluginEnabled).toBe(false)
    expect(summary.config.companionLifecycleHookStateEvents).toEqual([])
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

  test("#given installed plugin without the omo runtime bin #when checking Codex doctor #then reports the missing omo command", async () => {
    // given
    const { codexHome, binDir } = await createInstalledCodexHome()
    await rm(join(binDir, process.platform === "win32" ? "omo.cmd" : "omo"))

    // when
    const result = await checkCodex({
      codexHome,
      binDir,
      detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    })

    // then
    expect(result.status).toBe("fail")
    expect(result.issues.map((issue) => issue.title)).toContain("omo runtime command is not linked")
  })

  test("#given generated omo wrapper points at a deleted runtime target #when checking runtime wrapper #then warns with reinstall guidance", async () => {
    // given
    const { codexHome, binDir, pluginRoot } = await createInstalledCodexHome()
    const wrapperPath = join(binDir, process.platform === "win32" ? "omo.cmd" : "omo")
    await rm(wrapperPath)
    const missingCliPath = join(pluginRoot, "dist", "cli", "index.js")
    await writeFile(
      wrapperPath,
      process.platform === "win32"
        ? ["@echo off", "rem OMO_GENERATED_RUNTIME_WRAPPER", `"%%BUN_BINARY%%" "${missingCliPath}" %%*`, ""].join("\r\n")
        : ["#!/bin/sh", "# OMO_GENERATED_RUNTIME_WRAPPER", `exec "$BUN_BINARY" "${missingCliPath}" "$@"`, ""].join("\n"),
    )

    // when
    const result = await checkCodexRuntimeWrapper({ codexHome, binDir })

    // then
    expect(result.status).toBe("warn")
    const issue = result.issues.find((entry) => entry.title === "omo runtime wrapper target is missing")
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe("warning")
    expect(issue?.description).toContain(missingCliPath)
    expect(issue?.fix).toContain("npx --yes lazycodex-ai@latest install --no-tui")
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
    expect(result.details).toContain("Plugin: omo@4.7.5")
    expect(result.details).toContain("Distribution: lazycodex-ai@4.7.5")
    expect(result.details).toContain("Enabled plugin: omo@sisyphuslabs")
    expect(result.details).toContain("Companion plugin: none")
    expect(result.details).toContain("Linked bins: omo, omo-rules")
    expect(result.details).toContain("Agents: plan")
  })

  test("#given LazyCodex is primary and Codex Companion lifecycle hooks are configured #when checking Codex doctor #then warns without disabling anything", async () => {
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
        "enabled = true",
        "",
        '[plugins."codex@openai-codex"]',
        "enabled = true",
        "",
        '[hooks.state."codex@openai-codex:hooks/hooks.json:session_start:0:0"]',
        'trusted_hash = "sha256:session"',
        "",
        "[hooks.state.'codex@openai-codex:hooks/hooks.json:stop:0:0']",
        'trusted_hash = "sha256:stop"',
      ].join("\n"),
    )

    // when
    const result = await checkCodex({
      codexHome,
      binDir,
      detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    })
    const summary = await gatherCodexSummary({
      codexHome,
      binDir,
      detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    })

    // then
    expect(result.status).toBe("warn")
    expect(summary.config.companionPluginEnabled).toBe(true)
    expect(summary.config.companionLifecycleHookStateEvents).toEqual(["session_start", "stop"])
    expect(result.details).toContain("Companion plugin: codex@openai-codex enabled (SessionStart, Stop hook trust)")
    const issue = result.issues.find((entry) => entry.title === "Codex Companion lifecycle hooks may conflict with LazyCodex")
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe("warning")
    expect(issue?.description).toContain("codex@openai-codex is enabled")
    expect(issue?.description).toContain("SessionStart, Stop")
    expect(issue?.fix).toContain('[plugins."codex@openai-codex"] enabled = false')
  })

  test("#given a stamped plugin bundle #when gathering Codex summary #then it reports the installer version and stamped state", async () => {
    // given
    const { codexHome, binDir } = await createInstalledCodexHome()

    // when
    const summary = await gatherCodexSummary({
      codexHome,
      binDir,
      installerVersion: "4.8.1",
      detectCodexInstallation: async () => ({ found: true, source: "cli", path: "/usr/local/bin/codex" }),
    })

    // then
    expect(summary.pluginVersionStamped).toBe(true)
    expect(summary.installerVersion).toBe("4.8.1")
  })

  test("#given an un-stamped placeholder plugin bundle with no install snapshot #when checking Codex doctor #then it warns and points at the installer version", async () => {
    // given (Codex app plugin UI install leaves the placeholder version and no snapshot)
    const { codexHome, binDir, pluginRoot } = await createInstalledCodexHome()
    await writeFile(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "omo", version: "0.1.0" }))
    await rm(join(pluginRoot, "lazycodex-install.json"))

    // when
    const result = await checkCodex({
      codexHome,
      binDir,
      installerVersion: "4.8.1",
      detectCodexInstallation: async () => ({ found: true, source: "windows-start-app", appId: "com.openai.codex" }),
    })

    // then
    expect(result.status).toBe("warn")
    const stampIssue = result.issues.find((issue) => issue.title === "Codex plugin bundle is not version-stamped")
    expect(stampIssue).toBeDefined()
    expect(stampIssue?.severity).toBe("warning")
    expect(stampIssue?.description).toContain("oh-my-openagent 4.8.1")
    expect(stampIssue?.fix).toContain("npx lazycodex-ai install")
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
