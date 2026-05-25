import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { existsSync } from "node:fs"
import { installCachedPlugin, linkCachedPluginBins, pruneMarketplaceCache } from "./codex-cache"
import { updateCodexConfig } from "./codex-config-toml"
import { trustedHookStatesForPlugin } from "./codex-hook-trust"
import { readMarketplace, readPluginManifest, resolvePluginSource, validatePathSegment } from "./codex-marketplace"
import { defaultRunCommand } from "./codex-process"
import type { CodexInstallOptions, CodexInstallResult, InstalledPlugin } from "./types"

export async function runCodexInstaller(options: CodexInstallOptions = {}): Promise<CodexInstallResult> {
  const repoRoot = resolve(options.repoRoot ?? findRepoRootFromImporter(import.meta.dir))
  const codexHome = resolve(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"))
  const binDir = resolve(options.binDir ?? process.env.CODEX_LOCAL_BIN_DIR ?? join(homedir(), ".local", "bin"))
  const runCommand = options.runCommand ?? defaultRunCommand
  const log = options.log ?? (() => undefined)

  const codexPackageRoot = join(repoRoot, "packages", "omo-codex")
  const marketplace = await readMarketplace(repoRoot, {
    marketplacePath: join(codexPackageRoot, "marketplace.json"),
  })

  const installed: InstalledPlugin[] = []
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

  const configPath = join(codexHome, "config.toml")
  await updateCodexConfig({
    configPath,
    repoRoot: codexPackageRoot,
    marketplaceName: marketplace.name,
    pluginNames: marketplace.plugins.map((plugin) => plugin.name),
    trustedHookStates,
  })

  await trackCodexInstallTelemetry()

  return {
    marketplaceName: marketplace.name,
    installed,
    configPath,
    codexHome,
  }
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
