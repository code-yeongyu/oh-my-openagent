import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import type { OpencodeConfig } from "../types"
import { PACKAGE_NAME } from "../constants"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "../../../shared"
import { getConfigPaths } from "./config-paths"
import { stripJsonComments } from "./jsonc-strip"

export interface PluginEntryInfo {
  entry: string
  isPinned: boolean
  pinnedVersion: string | null
  configPath: string
}

const EXACT_SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/
const PACKAGE_NAMES = [PLUGIN_NAME, LEGACY_PLUGIN_NAME, PACKAGE_NAME]

interface WorkspacePackageJson {
  dependencies?: Record<string, string>
}

function readDependencyVersionForFileEntry(entry: string): string | null {
  try {
    const pluginPath = fileURLToPath(entry)
    const packageRoot = path.dirname(path.dirname(pluginPath))
    const workspaceDir = path.dirname(path.dirname(packageRoot))
    const workspacePackageJsonPath = path.join(workspaceDir, "package.json")

    if (!fs.existsSync(workspacePackageJsonPath)) {
      return null
    }

    const content = fs.readFileSync(workspacePackageJsonPath, "utf-8")
    const parsed = JSON.parse(content) as WorkspacePackageJson
    const dependencies = parsed.dependencies ?? {}

    for (const packageName of PACKAGE_NAMES) {
      if (dependencies[packageName]) {
        return dependencies[packageName]
      }
    }
  } catch {
    // ignore
  }

  return null
}

function getEntryVersionInfo(entry: string, packageName: string): { isPinned: boolean; pinnedVersion: string | null } {
  if (entry === packageName) {
    return { isPinned: false, pinnedVersion: null }
  }

  if (entry.startsWith(`${packageName}@`)) {
    const pinnedVersion = entry.slice(packageName.length + 1).trim() || null
    return {
      isPinned: pinnedVersion !== null && EXACT_SEMVER_REGEX.test(pinnedVersion),
      pinnedVersion,
    }
  }

  return { isPinned: false, pinnedVersion: null }
}

export function findPluginEntry(directory: string): PluginEntryInfo | null {
  for (const configPath of getConfigPaths(directory)) {
    try {
      if (!fs.existsSync(configPath)) continue
      const content = fs.readFileSync(configPath, "utf-8")
      const config = JSON.parse(stripJsonComments(content)) as OpencodeConfig
      const plugins = config.plugin ?? []

      for (const entry of plugins) {
        for (const packageName of PACKAGE_NAMES) {
          if (entry === packageName || entry.startsWith(`${packageName}@`)) {
            const versionInfo = getEntryVersionInfo(entry, packageName)
            return { entry, ...versionInfo, configPath }
          }
        }

        if (
          entry.startsWith("file://") &&
          PACKAGE_NAMES.some((packageName) => entry.includes(`/node_modules/${packageName}/dist/index.js`))
        ) {
          const dependencyVersion = readDependencyVersionForFileEntry(entry)
          const pinnedVersion = dependencyVersion?.trim() || null
          return {
            entry,
            isPinned: pinnedVersion !== null && EXACT_SEMVER_REGEX.test(pinnedVersion),
            pinnedVersion,
            configPath,
          }
        }
      }
    } catch {
      continue
    }
  }

  return null
}
