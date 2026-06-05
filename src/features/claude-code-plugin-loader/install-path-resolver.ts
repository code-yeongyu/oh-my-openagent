import { existsSync, readdirSync } from "fs"
import { dirname, join } from "path"
import { log } from "../../shared/logger"
import { derivePluginNameFromKey } from "./plugin-key"
import { findPluginManifestPath, readManifestFromPath } from "./plugin-manifest"

function parseSemverPrefix(name: string): [number, number, number] | null {
  const match = name.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)]
}

const SEMVER_SUFFIX_MARKER = /^\d+\.\d+\.\d+[-+]/

function compareCandidatePriority(
  a: { name: string },
  b: { name: string },
): number {
  const aIsUnknown = a.name === "unknown"
  const bIsUnknown = b.name === "unknown"
  if (aIsUnknown && !bIsUnknown) return 1
  if (!aIsUnknown && bIsUnknown) return -1

  const aVer = parseSemverPrefix(a.name)
  const bVer = parseSemverPrefix(b.name)
  if (aVer && bVer) {
    if (aVer[0] !== bVer[0]) return bVer[0] - aVer[0]
    if (aVer[1] !== bVer[1]) return bVer[1] - aVer[1]
    if (aVer[2] !== bVer[2]) return bVer[2] - aVer[2]
    const aHasSuffix = SEMVER_SUFFIX_MARKER.test(a.name)
    const bHasSuffix = SEMVER_SUFFIX_MARKER.test(b.name)
    if (!aHasSuffix && bHasSuffix) return -1
    if (aHasSuffix && !bHasSuffix) return 1
    return a.name.localeCompare(b.name)
  }
  if (aVer && !bVer) return -1
  if (!aVer && bVer) return 1
  return a.name.localeCompare(b.name)
}

export function resolveActualInstallPath(
  configuredInstallPath: string,
  pluginKey?: string,
): string | null {
  if (existsSync(configuredInstallPath)) {
    return configuredInstallPath
  }
  const parentDir = dirname(configuredInstallPath)
  if (!existsSync(parentDir)) {
    return null
  }
  let entries: string[]
  try {
    entries = readdirSync(parentDir)
  } catch (error) {
    if (error instanceof Error) {
      log("Failed to scan plugin parent directory for fallback version", {
        parentDir,
        error,
      })
      return null
    }
    throw error
  }

  const expectedName = pluginKey ? derivePluginNameFromKey(pluginKey) : null

  const candidates = entries
    .map((name) => ({ name, path: join(parentDir, name) }))
    .filter(({ path }) => {
      const manifestPath = findPluginManifestPath(path)
      if (!manifestPath) return false
      if (expectedName === null) return true
      const manifest = readManifestFromPath(manifestPath)
      if (!manifest?.name) return false
      return manifest.name === expectedName
    })
    .sort(compareCandidatePriority)
  return candidates[0]?.path ?? null
}
