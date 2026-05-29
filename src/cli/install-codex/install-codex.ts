import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { existsSync } from "node:fs"
import { installCachedPlugin, linkCachedPluginBins, pruneMarketplaceCache, pruneMarketplacePluginCaches } from "./codex-cache"
import { updateCodexConfig } from "./codex-config-toml"
import { trustedHookStatesForPlugin } from "./codex-hook-trust"
import { linkCachedPluginAgents } from "./link-cached-plugin-agents"
import { readMarketplace, readPluginManifest, resolvePluginSource, validatePathSegment } from "./codex-marketplace"
import { defaultRunCommand } from "./codex-process"
import type { CodexInstallOptions, CodexInstallResult, InstalledPlugin } from "./types"

const LAZYCODEX_MARKETPLACE_SOURCE = {
  sourceType: "git",
  source: "https://github.com/code-yeongyu/lazycodex.git",
  ref: "main",
} as const
const SISYPHUS_LEGACY_CACHE_MARKETPLACES = ["lazycodex", "code-yeongyu-codex-plugins"] as const

export async function runCodexInstaller(options: CodexInstallOptions = {}): Promise<CodexInstallResult> {
  const repoRoot = resolve(options.repoRoot ?? findRepoRootFromImporter(import.meta.dir))
  const codexHome = resolve(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"))
  const binDir = resolveCodexInstallerBinDir({ binDir: options.binDir, codexHome, env: process.env })
  const runCommand = options.runCommand ?? defaultRunCommand
  const log = options.log ?? (() => undefined)

  const codexPackageRoot = join(repoRoot, "packages", "omo-codex")
  const marketplace = await readMarketplace(repoRoot, {
    marketplacePath: join(codexPackageRoot, "marketplace.json"),
  })

  const installed: InstalledPlugin[] = []
  const agentConfigs = new Map<string, { readonly name: string; readonly configFile: string }>()
  for (const entry of marketplace.plugins) {
    const sourcePath = resolvePluginSource(codexPackageRoot, entry, { pathOverride: "./plugin" })
    const manifest = await readPluginManifest(sourcePath)
    if (manifest.name !== entry.name) {
      throw new Error(
        `plugin manifest name ${JSON.stringify(manifest.name)} does not match marketplace name ${JSON.stringify(entry.name)}`,
      )
    }

    const version = manifest.version ?? "local"
    validatePathSegment(version, "plugin version")
    log(`Building ${entry.name}@${version}`)

    const plugin = await installCachedPlugin({
      codexHome,
      marketplaceName: marketplace.name,
      name: entry.name,
      runCommand,
      sourcePath,
      version,
    })

    const links = await linkCachedPluginBins({ binDir, pluginRoot: plugin.path })
    for (const link of links) {
      log(`Linked ${link.name} -> ${link.target}`)
    }
    const agentLinks = await linkCachedPluginAgents({ codexHome, pluginRoot: plugin.path })
    for (const link of agentLinks) {
      log(`Linked agent ${link.name} -> ${link.target}`)
      const agentName = agentNameFromToml(link.name)
      agentConfigs.set(agentName, { name: agentName, configFile: `./agents/${link.name}` })
    }
    installed.push(plugin)
  }

  const trustedHookStates = (
    await Promise.all(
      installed.map((plugin) =>
        trustedHookStatesForPlugin({
          marketplaceName: marketplace.name,
          pluginName: plugin.name,
          pluginRoot: plugin.path,
        }),
      ),
    )
  ).flat()

  await pruneMarketplaceCache({
    codexHome,
    marketplaceName: marketplace.name,
    keepPluginNames: marketplace.plugins.map((plugin) => plugin.name),
  })
  for (const legacyMarketplaceName of legacyCacheMarketplaces(marketplace.name)) {
    await pruneMarketplacePluginCaches({
      codexHome,
      marketplaceName: legacyMarketplaceName,
      pluginNames: marketplace.plugins.map((plugin) => plugin.name),
    })
  }

  const configPath = join(codexHome, "config.toml")
  await updateCodexConfig({
    configPath,
    repoRoot: codexPackageRoot,
    marketplaceName: marketplace.name,
    marketplaceSource: LAZYCODEX_MARKETPLACE_SOURCE,
    pluginNames: marketplace.plugins.map((plugin) => plugin.name),
    trustedHookStates,
    agentConfigs: [...agentConfigs.values()].sort((left, right) => left.name.localeCompare(right.name)),
  })

  await trackCodexInstallTelemetry()

  return {
    marketplaceName: marketplace.name,
    installed,
    configPath,
    codexHome,
  }
}

export function resolveCodexInstallerBinDir(input: {
  readonly binDir?: string
  readonly codexHome: string
  readonly env?: { readonly [key: string]: string | undefined }
  readonly homeDir?: string
}): string {
  const explicitBinDir = input.binDir ?? input.env?.CODEX_LOCAL_BIN_DIR
  if (explicitBinDir !== undefined && explicitBinDir.trim().length > 0) return resolve(explicitBinDir)

  const homeDir = input.homeDir ?? homedir()
  const defaultCodexHome = resolve(homeDir, ".codex")
  const resolvedCodexHome = resolve(input.codexHome)
  if (resolvedCodexHome !== defaultCodexHome) return join(resolvedCodexHome, "bin")
  return resolve(homeDir, ".local", "bin")
}

function agentNameFromToml(fileName: string): string {
  return fileName.endsWith(".toml") ? fileName.slice(0, -".toml".length) : fileName
}

function legacyCacheMarketplaces(marketplaceName: string): readonly string[] {
  return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_CACHE_MARKETPLACES : []
}

function findRepoRootFromImporter(importerDir: string): string {
  let current = importerDir
  for (let depth = 0; depth <= 5; depth += 1) {
    const pluginManifestPath = join(current, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json")
    if (existsSyncLike(pluginManifestPath)) return current
    current = resolve(current, "..")
  }
  throw new Error(
    "Unable to locate vendored Codex plugin: expected packages/omo-codex/plugin/.codex-plugin/plugin.json within 5 parent levels",
  )
}

function existsSyncLike(path: string): boolean {
  return existsSync(path)
}

async function trackCodexInstallTelemetry(): Promise<void> {
  try {
    const { createInstallPostHog, getPostHogDistinctId } = await import("@oh-my-opencode/omo-codex/telemetry")
    const posthog = createInstallPostHog()
    posthog.trackActive(getPostHogDistinctId(), "install_completed")
    await posthog.shutdown()
  } catch {
    // no-excuse-ok: catch
    // telemetry must never break installs
  }
}
