import { win32 } from "node:path"

import { canonicalPath, configPaths, discoveryFileSystem, pathKey, profileDirectories, projectDirectories } from "./discovery-paths"
import { configRoots } from "./discovery-roots"
import {
  type ConfigMigrationDiscoveryOptions,
  type DiscoveredLegacyConfigSource,
  type LegacyConfigMigrationGroup,
} from "./types"

export const OPENCODE_CONFIG_MIGRATION_ID = "2026-07-opencode-config-unification"
export const CONFIG_JSONC_MIGRATION_ID = "2026-07-codex-config-jsonc"

function addConfigAndSidecar(
  sources: DiscoveredLegacyConfigSource[],
  seen: Set<string>,
  source: Omit<DiscoveredLegacyConfigSource, "kind" | "path">,
  options: ConfigMigrationDiscoveryOptions,
): void {
  const configPath = canonicalPath(source.configPath, options)
  const configKey = pathKey(configPath, options)
  if (!seen.has(configKey) && discoveryFileSystem(options).existsSync(source.configPath)) {
    seen.add(configKey)
    sources.push({ ...source, configPath, kind: source.projectRoot === undefined
      ? (source.profile === undefined ? "user-config" : "profile-config")
      : "project-config", path: configPath })
  }
  const sidecarPath = `${source.configPath}.migrations.json`
  const sidecarKey = pathKey(sidecarPath, options)
  if (!seen.has(sidecarKey) && discoveryFileSystem(options).existsSync(sidecarPath)) {
    seen.add(sidecarKey)
    sources.push({ ...source, configPath, kind: "migration-sidecar", path: canonicalPath(sidecarPath, options) })
  }
}

function discoverOpenCodeSources(options: ConfigMigrationDiscoveryOptions): readonly DiscoveredLegacyConfigSource[] {
  const sources: DiscoveredLegacyConfigSource[] = []
  const seen = new Set<string>()
  for (const root of configRoots(options)) {
    for (const [index, configPath] of configPaths(root.path, options).entries()) {
      addConfigAndSidecar(sources, seen, {
        baseRoot: root.path,
        configPath,
        precedence: root.precedence * 10 + index,
      }, options)
    }
    for (const profile of profileDirectories(root.path, options)) {
      const profileDirectory = options.pathOperations.join(root.path, "profiles", profile)
      for (const [index, configPath] of configPaths(profileDirectory, options).entries()) {
        addConfigAndSidecar(sources, seen, {
          baseRoot: root.path,
          configPath,
          ...(root.activeProfile !== undefined
            && (root.activeProfile === profile || (
              options.pathOperations === win32 && root.activeProfile.toLowerCase() === profile.toLowerCase()
            ))
            ? { isActiveProfile: true }
            : {}),
          precedence: root.precedence * 10 + index,
          profile,
        }, options)
      }
    }
  }
  for (const [directoryIndex, projectRoot] of projectDirectories(options).entries()) {
    const configDirectory = options.pathOperations.join(projectRoot, ".opencode")
    for (const [fileIndex, configPath] of configPaths(configDirectory, options).entries()) {
      addConfigAndSidecar(sources, seen, {
        configPath,
        precedence: 1000 + directoryIndex * 10 + fileIndex,
        projectRoot,
      }, options)
    }
  }
  return sources
}

function discoverConfigJsoncSources(options: ConfigMigrationDiscoveryOptions): readonly DiscoveredLegacyConfigSource[] {
  const configPath = options.pathOperations.join(options.homeDir, ".omo", "config.jsonc")
  const sources: DiscoveredLegacyConfigSource[] = []
  if (discoveryFileSystem(options).existsSync(configPath)) {
    sources.push({
      configPath: canonicalPath(configPath, options),
      kind: "config-jsonc",
      path: canonicalPath(configPath, options),
      precedence: 0,
    })
  }
  const sidecarPath = `${configPath}.migrations.json`
  if (discoveryFileSystem(options).existsSync(sidecarPath)) {
    sources.push({
      configPath: canonicalPath(configPath, options),
      kind: "migration-sidecar",
      path: canonicalPath(sidecarPath, options),
      precedence: 0,
    })
  }
  return sources
}

export function discoverLegacyConfigGroups(options: ConfigMigrationDiscoveryOptions): readonly LegacyConfigMigrationGroup[] {
  return [
    { id: OPENCODE_CONFIG_MIGRATION_ID, sources: discoverOpenCodeSources(options) },
    { id: CONFIG_JSONC_MIGRATION_ID, sources: discoverConfigJsoncSources(options) },
  ]
}
