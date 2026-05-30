import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { installCachedPlugin, linkCachedPluginBins, pruneMarketplaceCache, pruneMarketplacePluginCaches } from "./codex-cache"
import { updateCodexConfig } from "./codex-config-toml"
import { trustedHookStatesForPlugin } from "./codex-hook-trust"
import { resolveGitBashForCurrentProcess } from "./git-bash"
import { linkCachedPluginAgents } from "./link-cached-plugin-agents"
import { readMarketplace, readPluginManifest, resolvePluginSource, validatePathSegment } from "./codex-marketplace"
import { writeInstalledMarketplaceSnapshot, type MarketplaceSnapshotPluginSource } from "./codex-marketplace-snapshot"
import { defaultRunCommand } from "./codex-process"
import type { CodexInstallOptions, CodexInstallResult, CodexMarketplaceSource, InstalledPlugin, MarketplaceManifest } from "./types"

const SISYPHUS_LEGACY_CACHE_MARKETPLACES = ["lazycodex", "code-yeongyu-codex-plugins"] as const

export async function runCodexInstaller(options: CodexInstallOptions = {}): Promise<CodexInstallResult> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const repoRoot = resolve(options.repoRoot ?? findRepoRoot({ importerDir: import.meta.dir, env }))
  const codexHome = resolve(options.codexHome ?? env.CODEX_HOME ?? join(homedir(), ".codex"))
  const binDir = resolveCodexInstallerBinDir({ binDir: options.binDir, codexHome, env })
  const runCommand = options.runCommand ?? defaultRunCommand
  const log = options.log ?? (() => undefined)

  const gitBashResolution = platform === "win32"
    ? (options.gitBashResolver ?? (() => resolveGitBashForCurrentProcess({ platform, env })))()
    : { found: true, path: null, source: "not-required" } as const
  if (!gitBashResolution.found) {
    throw new Error(gitBashResolution.installHint)
  }

  const codexPackageRoot = join(repoRoot, "packages", "omo-codex")
  const marketplace = await readMarketplace(repoRoot, {
    marketplacePath: join(codexPackageRoot, "marketplace.json"),
  })

  const installed: InstalledPlugin[] = []
  const pluginSources: MarketplaceSnapshotPluginSource[] = []
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
    pluginSources.push({ name: entry.name, sourcePath })
    installed.push(plugin)
  }

  const agentSourceRoots = await agentSourceRootsForInstall({
    codexHome,
    marketplace,
    installed,
    pluginSources,
  })
  for (const plugin of installed) {
    const pluginRoot = agentSourceRoots.get(plugin.name) ?? plugin.path
    const agentLinks = await linkCachedPluginAgents({ codexHome, pluginRoot })
    for (const link of agentLinks) {
      log(`Linked agent ${link.name} -> ${link.target}`)
      const agentName = agentNameFromToml(link.name)
      agentConfigs.set(agentName, { name: agentName, configFile: `./agents/${link.name}` })
    }
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

  const marketplaceRoot = join(codexHome, "plugins", "cache", marketplace.name)
  await writeCachedMarketplaceManifest({
    marketplaceName: marketplace.name,
    marketplaceRoot,
    plugins: installed,
  })

  const configPath = join(codexHome, "config.toml")
  await updateCodexConfig({
    configPath,
    repoRoot: codexPackageRoot,
    marketplaceName: marketplace.name,
    marketplaceSource: codexMarketplaceSource(marketplaceRoot),
    pluginNames: marketplace.plugins.map((plugin) => plugin.name),
    trustedHookStates,
    agentConfigs: [...agentConfigs.values()].sort((left, right) => left.name.localeCompare(right.name)),
    autonomousPermissions: options.autonomousPermissions === true,
  })

  await trackCodexInstallTelemetry()

  return {
    marketplaceName: marketplace.name,
    installed,
    configPath,
    codexHome,
    gitBashPath: gitBashResolution.path,
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

async function agentSourceRootsForInstall(input: {
  readonly codexHome: string
  readonly marketplace: MarketplaceManifest
  readonly installed: readonly InstalledPlugin[]
  readonly pluginSources: readonly MarketplaceSnapshotPluginSource[]
}): Promise<ReadonlyMap<string, string>> {
  if (input.marketplace.name !== "sisyphuslabs") {
    return new Map(input.installed.map((plugin) => [plugin.name, plugin.path]))
  }
  const snapshotPlugins = await writeInstalledMarketplaceSnapshot({
    codexHome: input.codexHome,
    marketplace: input.marketplace,
    plugins: input.pluginSources,
  })
  return new Map(snapshotPlugins.map((plugin) => [plugin.name, plugin.path]))
}

async function writeCachedMarketplaceManifest(input: {
  readonly marketplaceName: string
  readonly marketplaceRoot: string
  readonly plugins: readonly InstalledPlugin[]
}): Promise<void> {
  const marketplaceDir = join(input.marketplaceRoot, ".agents", "plugins")
  await mkdir(marketplaceDir, { recursive: true })
  await writeFile(
    join(marketplaceDir, "marketplace.json"),
    `${JSON.stringify(
      {
        name: input.marketplaceName,
        plugins: input.plugins.map((plugin) => ({
          name: plugin.name,
          source: { source: "local", path: `./${plugin.name}/${plugin.version}` },
        })),
      },
      null,
      "\t",
    )}\n`,
  )
}

function legacyCacheMarketplaces(marketplaceName: string): readonly string[] {
  return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_CACHE_MARKETPLACES : []
}

function codexMarketplaceSource(marketplaceRoot: string): CodexMarketplaceSource {
  return { sourceType: "local", source: marketplaceRoot }
}

export function findRepoRootFromImporter(importerDir: string): string {
  let current = importerDir
  for (let depth = 0; depth <= 5; depth += 1) {
    if (isRepoRootWithCodexPlugin(current)) return current
    for (const wrapperPackageRoot of [join(current, "node_modules", "oh-my-openagent"), join(current, "oh-my-openagent")]) {
      if (isRepoRootWithCodexPlugin(wrapperPackageRoot)) return wrapperPackageRoot
    }
    current = resolve(current, "..")
  }
  throw new Error(
    "Unable to locate vendored Codex plugin: expected packages/omo-codex/plugin/.codex-plugin/plugin.json in this package or sibling oh-my-openagent package within 5 parent levels",
  )
}

export function findRepoRoot(input: {
  readonly importerDir: string
  readonly env?: { readonly [key: string]: string | undefined }
}): string {
  const wrapperPackageRoot = input.env?.OMO_WRAPPER_PACKAGE_ROOT
  if (wrapperPackageRoot !== undefined && wrapperPackageRoot.trim().length > 0) {
    const resolvedWrapperPackageRoot = resolve(wrapperPackageRoot)
    if (isRepoRootWithCodexPlugin(resolvedWrapperPackageRoot)) return resolvedWrapperPackageRoot
  }
  return findRepoRootFromImporter(input.importerDir)
}

function isRepoRootWithCodexPlugin(repoRoot: string): boolean {
  return existsSyncLike(join(repoRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"))
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
  } catch (error) {
    if (error instanceof Error) return
    return
  }
}
