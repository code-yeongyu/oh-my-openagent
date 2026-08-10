import { canonicalPath, hostPathOperations, isWindowsPathOperations, pathKey, usesWindowsPathSemantics } from "./discovery-paths"
import type { ConfigMigrationDiscoveryOptions } from "./types"

const TAURI_IDENTIFIERS = ["ai.opencode.desktop", "ai.opencode.desktop.dev"] as const

export type ConfigRoot = {
  readonly activeProfile?: string
  readonly path: string
  readonly precedence: number
}

function environmentValue(options: ConfigMigrationDiscoveryOptions, key: string): string | undefined {
  const value = options.environment?.[key]?.trim()
  return value === "" ? undefined : value
}

function isWindowsPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || /^\/mnt\/[a-z]\/users\//i.test(path.replaceAll("\\", "/"))
}

function isWsl(options: ConfigMigrationDiscoveryOptions): boolean {
  return options.platform === "linux" && (
    environmentValue(options, "WSL_DISTRO_NAME") !== undefined
    || environmentValue(options, "WSL_INTEROP") !== undefined
  )
}

function configBaseDirectory(options: ConfigMigrationDiscoveryOptions): string {
  const configured = environmentValue(options, "XDG_CONFIG_HOME")
  if (configured !== undefined && !(isWsl(options) && isWindowsPath(configured))) return configured
  return options.pathOperations.join(options.homeDir, ".config")
}

function defaultRoot(options: ConfigMigrationDiscoveryOptions): string {
  return options.pathOperations.join(configBaseDirectory(options), "opencode")
}

function defaultTauriRoots(options: ConfigMigrationDiscoveryOptions): readonly string[] {
  if (options.tauriConfigDirs !== undefined) return options.tauriConfigDirs
  if (options.platform === "darwin") {
    const supportDir = options.pathOperations.join(options.homeDir, "Library", "Application Support")
    return TAURI_IDENTIFIERS.map((identifier) => options.pathOperations.join(supportDir, identifier))
  }
  const base = configBaseDirectory(options)
  return TAURI_IDENTIFIERS.map((identifier) => options.pathOperations.join(base, identifier))
}

function windowsRoots(options: ConfigMigrationDiscoveryOptions): readonly string[] {
  if (!usesWindowsPathSemantics(options)) return []
  const pathOperations = hostPathOperations(options)
  const appData = environmentValue(options, "APPDATA")
    ?? pathOperations.join(options.homeDir, "AppData", "Roaming")
  return [
    pathOperations.join(appData, "opencode"),
    ...TAURI_IDENTIFIERS.map((identifier) => pathOperations.join(appData, identifier)),
  ]
}

function activeProfileRoot(path: string, options: ConfigMigrationDiscoveryOptions): ConfigRoot {
  const normalized = options.pathOperations.normalize(path)
  const profilesDirectory = options.pathOperations.dirname(normalized)
  if (options.pathOperations.basename(profilesDirectory).toLowerCase() !== "profiles") {
    return { path: normalized, precedence: 0 }
  }
  return {
    activeProfile: options.pathOperations.basename(normalized),
    path: options.pathOperations.dirname(profilesDirectory),
    precedence: 0,
  }
}

export function configRoots(options: ConfigMigrationDiscoveryOptions): readonly ConfigRoot[] {
  const custom = environmentValue(options, "OPENCODE_CONFIG_DIR")
  const candidates: ConfigRoot[] = [
    ...(custom === undefined ? [] : [activeProfileRoot(custom, options)]),
    { path: defaultRoot(options), precedence: 1 },
    ...defaultTauriRoots(options).map((path, index) => ({ path, precedence: index + 2 })),
    ...windowsRoots(options).map((path, index) => ({ path, precedence: index + 4 })),
  ]
  const seen = new Set<string>()
  const result: ConfigRoot[] = []
  for (const candidate of candidates) {
    const key = pathKey(candidate.path, options)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ ...candidate, path: canonicalPath(candidate.path, options) })
  }
  return result
}
