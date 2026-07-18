import { join, resolve } from "node:path"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { installCachedPlugin, linkCachedPluginBins, linkRootRuntimeBin, pruneMarketplaceCache, pruneMarketplacePluginCaches } from "./codex-cache"
import { writeCachedMarketplaceManifest } from "./codex-cached-marketplace-manifest"
import { shouldBuildSourcePackages } from "./codex-package-layout"
import { updateCodexConfig } from "./codex-config-toml"
import { trustedHookStatesForPlugin } from "./codex-hook-trust"
import { prepareGitBashForInstall, resolveGitBashForCurrentProcess } from "./git-bash"
import { capturePreservedAgentReasoning, capturePreservedAgentServiceTier, linkCachedPluginAgents } from "./link-cached-plugin-agents"
import { readMarketplace, readPluginManifest, resolvePluginSource, validatePathSegment } from "./codex-marketplace"
import { writeInstalledMarketplaceSnapshot, type MarketplaceSnapshotPluginSource } from "./codex-marketplace-snapshot"
import { readDistributionManifest, resolveLazyCodexPluginVersion, stampLazyCodexPluginVersion, writeLazyCodexInstallSnapshot } from "./lazycodex-version-stamp"
import { defaultRunCommand } from "./codex-process"
import { repairProjectLocalCodexArtifactsBestEffort } from "./codex-project-local-cleanup-best-effort"
import { reapLspDaemons } from "./lsp-daemon-reaper"
import { resolveCodexInstallerBinDir } from "./codex-installer-bin-dir"
import { removeGitBashHooksOffWindows } from "./codex-git-bash-hooks"
import { seedAndMigrateOmoSot } from "./omo-sot-migration"
import { installAstGrepForCodex } from "./install-ast-grep-sg"
import { trackCodexInstallTelemetry } from "./codex-install-telemetry"
import { resolveCodegraphNodeSupport } from "@oh-my-opencode/utils"
import type { CodexInstallOptions, CodexInstallResult, CodexMarketplaceSource, InstalledPlugin, MarketplaceManifest } from "./types"

const SISYPHUS_LEGACY_CACHE_MARKETPLACES = ["lazycodex", "code-yeongyu-codex-plugins"] as const

export async function runCodexInstaller(options: CodexInstallOptions = {}): Promise<CodexInstallResult> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const repoRoot = resolve(options.repoRoot ?? findRepoRoot({ importerDir: import.meta.dir, env }))
  const codexHome = resolve(options.codexHome ?? env.CODEX_HOME ?? join(homedir(), ".codex"))
  const projectDirectory = resolve(options.projectDirectory ?? env.OMO_CODEX_PROJECT ?? process.cwd())
  const binDir = resolveCodexInstallerBinDir({ binDir: options.binDir, codexHome, env })
  const runCommand = options.runCommand ?? defaultRunCommand
  const log = options.log ?? (() => undefined)
  const buildSource = await shouldBuildSourcePackages(repoRoot)
  const versionOverride = env.LAZYCODEX_DEV_VERSION?.trim() || undefined

  const gitBashResolution = await prepareGitBashForInstall({
    platform,
    env,
    resolveGitBash: platform === "win32"
      ? (options.gitBashResolver ?? (() => resolveGitBashForCurrentProcess({ platform, env })))
      : undefined,
  })
  if (!gitBashResolution.found) {
    throw new Error(gitBashResolution.installHint)
  }

  const codexPackageRoot = join(repoRoot, "packages", "omo-codex")
  const marketplace = await readMarketplace(repoRoot, {
    marketplacePath: join(codexPackageRoot, "marketplace.json"),
  })
  const distributionManifest = await readDistributionManifest(repoRoot)

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

    const version = resolveLazyCodexPluginVersion({
      manifestVersion: manifest.version,
      marketplaceName: marketplace.name,
      pluginName: entry.name,
      distributionManifest,
      versionOverride,
    })
    validatePathSegment(version, "plugin version")
    log(`Building ${entry.name}@${version}`)

    const plugin = await installCachedPlugin({
      buildSource,
      codexHome,
      env,
      marketplaceName: marketplace.name,
      name: entry.name,
      runCommand,
      sourcePath,
      version,
    })
    if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
      await stampLazyCodexPluginVersion({ pluginRoot: plugin.path, version })
      await writeLazyCodexInstallSnapshot({ pluginRoot: plugin.path, distributionManifest })
      await removeGitBashHooksOffWindows({ platform, pluginRoot: plugin.path })
    }

    const links = await linkCachedPluginBins({ binDir, pluginRoot: plugin.path, platform })
    for (const link of links) {
      log(`Linked ${link.name} -> ${link.target}`)
    }
    if (marketplace.name === "sisyphuslabs" && plugin.name === "omo") {
      const runtimeLink = await linkRootRuntimeBin({ binDir, codexHome, repoRoot, platform })
      if (runtimeLink !== null) log(`Linked ${runtimeLink.name} -> ${runtimeLink.target}`)
      else
        log(
          `Warning: skipped the omo runtime wrapper because ${join(repoRoot, "dist", "cli", "index.js")} is missing; omo ulw-loop commands will be unavailable until a package shipping dist/cli is installed`,
        )
    }
    pluginSources.push({ name: entry.name, sourcePath })
    installed.push(plugin)
  }

  await installAstGrepForCodex({
    codexHome,
    installed,
    installer: options.astGrepInstaller,
    log,
    platform,
  })

  const preservedReasoning = await capturePreservedAgentReasoning({ codexHome })
  const preservedServiceTier = await capturePreservedAgentServiceTier({ codexHome })
  const agentSourceRoots = await agentSourceRootsForInstall({
    codexHome,
    marketplace,
    installed,
    pluginSources,
  })
  for (const plugin of installed) {
    const pluginRoot = agentSourceRoots.get(plugin.name) ?? plugin.path
    const agentLinks = await linkCachedPluginAgents({
      codexHome,
      pluginRoot,
      platform,
      preservedReasoning,
      preservedServiceTier,
    })
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
          platform,
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

  const legacyDaemonCleanup = await reapLspDaemons(codexHome).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    log(`Warning: skipped legacy Codex LSP daemon cleanup: ${message}`)
    return []
  })
  for (const cleanup of legacyDaemonCleanup) {
    if (cleanup.status !== "deferred") continue
    log(`Warning: deferred legacy Codex LSP daemon cleanup for v${cleanup.version}: ${cleanup.reason}`)
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
    platform,
    codegraphMcpEnabled: options.codegraphMcpEnabled ?? resolveCodegraphNodeSupport({ env }).supported,
    gitBashEnabled: platform === "win32" && gitBashResolution.found,
    trustedHookStates,
    agentConfigs: [...agentConfigs.values()].sort((left, right) => left.name.localeCompare(right.name)),
    autonomousPermissions: options.autonomousPermissions !== false,
  })
  await seedAndMigrateOmoSot({ env, log, repoRoot, runCommand })

  const projectCleanup = await repairProjectLocalCodexArtifactsBestEffort({
    startDirectory: projectDirectory,
    codexHome,
    log,
  })
  for (const configCleanup of projectCleanup.configs) {
    if (!configCleanup.changed) continue
    log(`Repaired project Codex config ${configCleanup.configPath} (backup: ${configCleanup.backupPath})`)
  }
  for (const artifact of projectCleanup.artifacts) {
    log(`Found project-local legacy artifact ${artifact.path}; left in place`)
  }

  await trackCodexInstallTelemetry()

  return {
    marketplaceName: marketplace.name,
    installed,
    configPath,
    codexHome,
    gitBashPath: gitBashResolution.path,
    projectCleanup,
  }
}

export { resolveCodexInstallerBinDir } from "./codex-installer-bin-dir"

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

function legacyCacheMarketplaces(marketplaceName: string): readonly string[] {
  return marketplaceName === "sisyphuslabs" ? SISYPHUS_LEGACY_CACHE_MARKETPLACES : []
}

export function findRepoRootFromImporter(importerDir: string): string {
  let current = importerDir
  for (let depth = 0; depth <= 7; depth += 1) {
    if (isRepoRootWithCodexPlugin(current)) return current
    for (const wrapperPackageRoot of [join(current, "node_modules", "oh-my-openagent"), join(current, "oh-my-openagent")]) {
      if (isRepoRootWithCodexPlugin(wrapperPackageRoot)) return wrapperPackageRoot
    }
    current = resolve(current, "..")
  }
  throw new Error(
    "Unable to locate vendored Codex plugin: expected packages/omo-codex/plugin/.codex-plugin/plugin.json in this package or sibling oh-my-openagent package within 7 parent levels",
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
  return existsSync(join(repoRoot, "packages", "omo-codex", "plugin", ".codex-plugin", "plugin.json"))
}

function codexMarketplaceSource(marketplaceRoot: string): CodexMarketplaceSource {
  return { sourceType: "local", source: marketplaceRoot }
}
