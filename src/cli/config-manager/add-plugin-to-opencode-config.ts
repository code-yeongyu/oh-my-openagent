import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { applyEdits, modify } from "jsonc-parser"
import type { ConfigMergeResult } from "../types"
import { LEGACY_PLUGIN_NAME, PLUGIN_NAME, parseJsonc } from "../../shared"
import { getConfigContext, getConfigDir } from "./config-context"
import { ensureConfigDirectoryExists } from "./ensure-config-directory-exists"
import { formatErrorWithSuggestion } from "./format-error-with-suggestion"
import { detectConfigFormat } from "./opencode-config-format"
import { parseOpenCodeConfigFileWithError, type OpenCodeConfig } from "./parse-opencode-config-file"
import { getPluginNameWithVersion } from "./plugin-name-with-version"

interface PackageJsonShape {
  dependencies?: Record<string, string>
  [key: string]: unknown
}

const INSTALL_PACKAGE_NAME = LEGACY_PLUGIN_NAME

function isPackageEntry(entry: string, packageName: string): boolean {
  return entry === packageName || entry.startsWith(`${packageName}@`)
}

function isOurPackageEntry(entry: string): boolean {
  return isPackageEntry(entry, PLUGIN_NAME) || isPackageEntry(entry, LEGACY_PLUGIN_NAME)
}

function isOurFileEntry(entry: string): boolean {
  return entry.startsWith("file://") && (entry.includes(PLUGIN_NAME) || entry.includes(LEGACY_PLUGIN_NAME))
}

function isManagedFileEntry(entry: string): boolean {
  return entry.startsWith("file://") && entry.includes(`/node_modules/${INSTALL_PACKAGE_NAME}/dist/index.js`)
}

function getDependencySpecFromPackageEntry(entry: string): string | null {
  if (!isOurPackageEntry(entry)) {
    return null
  }

  const atIndex = entry.indexOf("@")
  if (atIndex === -1) {
    return "latest"
  }

  return entry.slice(atIndex + 1) || "latest"
}

function getDependencySpecFromExistingPackageJson(packageJsonPath: string): string | null {
  if (!existsSync(packageJsonPath)) {
    return null
  }

  const content = readFileSync(packageJsonPath, "utf-8")
  const parsed = parseJsonc<PackageJsonShape>(content)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid package.json at ${packageJsonPath}`)
  }

  return parsed.dependencies?.[INSTALL_PACKAGE_NAME] ?? parsed.dependencies?.[PLUGIN_NAME] ?? null
}

function buildManagedPluginEntry(configDir: string): string {
  return pathToFileURL(join(configDir, "node_modules", INSTALL_PACKAGE_NAME, "dist", "index.js")).toString()
}

function writeJsoncPluginArray(path: string, pluginEntries: string[]): void {
  const content = readFileSync(path, "utf-8")
  const edits = modify(content, ["plugin"], pluginEntries, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
      eol: "\n",
    },
    getInsertionIndex: () => 0,
  })

  writeFileSync(path, edits.length > 0 ? applyEdits(content, edits) : content)
}

function writePackageJsonDependency(packageJsonPath: string, dependencySpec: string): void {
  let packageJson: PackageJsonShape = {}

  if (existsSync(packageJsonPath)) {
    const content = readFileSync(packageJsonPath, "utf-8")
    const parsed = parseJsonc<PackageJsonShape>(content)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid package.json at ${packageJsonPath}`)
    }
    packageJson = parsed
  }

  const dependencies = { ...(packageJson.dependencies ?? {}) }
  delete dependencies[PLUGIN_NAME]
  dependencies[INSTALL_PACKAGE_NAME] = dependencySpec
  packageJson.dependencies = dependencies

  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n")
}

export async function addPluginToOpenCodeConfig(currentVersion: string): Promise<ConfigMergeResult> {
  try {
    ensureConfigDirectoryExists()
  } catch (err) {
    return {
      success: false,
      configPath: getConfigDir(),
      error: formatErrorWithSuggestion(err, "create config directory"),
    }
  }

  const { format, path } = detectConfigFormat()
  const configDir = getConfigDir()
  const packageJsonPath = getConfigContext().paths.packageJson
  const managedPluginEntry = buildManagedPluginEntry(configDir)

  try {
    const pluginEntry = await getPluginNameWithVersion(currentVersion, INSTALL_PACKAGE_NAME)
    const defaultDependencySpec = getDependencySpecFromPackageEntry(pluginEntry) ?? "latest"

    if (format === "none") {
      writePackageJsonDependency(packageJsonPath, defaultDependencySpec)

      const config: OpenCodeConfig = { plugin: [managedPluginEntry] }
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
      return { success: true, configPath: path }
    }

    const parseResult = parseOpenCodeConfigFileWithError(path)
    if (!parseResult.config) {
      return {
        success: false,
        configPath: path,
        error: parseResult.error ?? "Failed to parse config file",
      }
    }

    const config = parseResult.config
    const plugins = config.plugin ?? []
    const localDevEntries = plugins.filter((plugin) => isOurFileEntry(plugin) && !isManagedFileEntry(plugin))
    const packageEntries = plugins.filter(isOurPackageEntry)
    const normalizedPlugins = plugins.filter((plugin) => !isOurPackageEntry(plugin) && !isOurFileEntry(plugin))

    if (localDevEntries.length > 0) {
      normalizedPlugins.push(localDevEntries[0])
    } else {
      const preservedDependencySpec = packageEntries
        .map(getDependencySpecFromPackageEntry)
        .find((value): value is string => Boolean(value))
        ?? getDependencySpecFromExistingPackageJson(packageJsonPath)
        ?? defaultDependencySpec

      writePackageJsonDependency(packageJsonPath, preservedDependencySpec)
      normalizedPlugins.push(managedPluginEntry)
    }

    config.plugin = normalizedPlugins

    if (format === "jsonc") {
      writeJsoncPluginArray(path, normalizedPlugins)
    } else {
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n")
    }

    return { success: true, configPath: path }
  } catch (err) {
    return {
      success: false,
      configPath: path,
      error: formatErrorWithSuggestion(err, "update opencode config"),
    }
  }
}
