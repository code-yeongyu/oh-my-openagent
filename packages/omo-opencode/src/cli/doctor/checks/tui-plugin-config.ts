import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  ACCEPTED_PACKAGE_NAMES,
  LEGACY_PLUGIN_NAME,
  PLUGIN_NAME,
  getOpenCodeConfigDir,
  getOpenCodeConfigPaths,
  log,
  parseJsonc,
} from "../../../shared"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"

const TUI_SUBPATH = "tui"
const TUI_EXPORT_SUBPATH = `./${TUI_SUBPATH}`

interface OpenCodeConfigShape {
  plugin?: (string | [string, unknown])[]
}

interface TuiConfigShape {
  plugin?: (string | [string, unknown])[]
}

interface ServerPluginInfo {
  registered: boolean
  configPath: string | null
  entry: string | null
  packageExportsTui: boolean | null
}

interface TuiPluginInfo {
  registered: boolean
  configPath: string | null
  exists: boolean
  hasPackageTuiEntry: boolean
  hasNamedTuiEntry: boolean
  hasCanonicalNamedTuiEntry: boolean
}

function fileEntryPackageJsonPath(entry: string): string {
  let path = entry.slice("file:".length)
  if (path.startsWith("//")) path = path.slice(2)
  return join(path, "package.json")
}

function packageJsonExportsTui(pkgJsonPath: string): boolean | null {
  if (!existsSync(pkgJsonPath)) return null

  try {
    const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { exports?: unknown }
    if (parsed.exports === undefined) return null
    if (typeof parsed.exports === "string") return false
    if (parsed.exports == null || typeof parsed.exports !== "object" || Array.isArray(parsed.exports)) return null
    return Object.hasOwn(parsed.exports, TUI_EXPORT_SUBPATH)
  } catch (error) {
    log("[tui-plugin-config] Failed to inspect package exports", {
      pkgJsonPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function packageNameFromServerEntry(entry: unknown): string | null {
  if (typeof entry === "string" && (entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`))) return PLUGIN_NAME
  if (typeof entry === "string" && (entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`))) return LEGACY_PLUGIN_NAME
  return null
}

function isPackagePluginEntry(entry: unknown): boolean {
  return packageNameFromServerEntry(entry) !== null
}

function packageExportsTuiForServerEntry(entry: unknown): boolean | null {
  if (typeof entry === "string" && entry.startsWith("file:")) return packageJsonExportsTui(fileEntryPackageJsonPath(entry))

  const packageName = packageNameFromServerEntry(entry)
  if (packageName === null) return null

  return packageJsonExportsTui(join(getOpenCodeConfigDir({ binary: "opencode" }), "node_modules", packageName, "package.json"))
}

export function isOurFilePluginEntry(entry: unknown): boolean {
  if (typeof entry !== "string" || !entry.startsWith("file:")) return false
  try {
    const pkgJsonPath = fileEntryPackageJsonPath(entry)
    if (!existsSync(pkgJsonPath)) return false
    const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name?: unknown }
    return typeof parsed.name === "string"
      && (ACCEPTED_PACKAGE_NAMES as readonly string[]).includes(parsed.name)
  } catch (error) {
    log("[tui-plugin-config] Failed to inspect file plugin package", {
      entry,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export function isServerPluginEntry(entry: unknown): entry is string {
  if (typeof entry === "string" && (entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`))) return true
  if (typeof entry === "string" && (entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`))) return true
  if (typeof entry === "string" && entry.startsWith("file:") && isOurFilePluginEntry(entry)) return true
  return false
}

export function isTuiPluginEntry(entry: unknown): boolean {
  return typeof entry === "string" && (isPackagePluginEntry(entry) || (entry.startsWith("file:") && isOurFilePluginEntry(entry)))
}

export function isNamedTuiPluginEntry(entry: unknown): boolean {
  const canonicalPrefix = `${PLUGIN_NAME}/${TUI_SUBPATH}`
  const legacyPrefix = `${LEGACY_PLUGIN_NAME}/${TUI_SUBPATH}`
  return typeof entry === "string"
    && (entry === canonicalPrefix
      || entry.startsWith(`${canonicalPrefix}@`)
      || entry === legacyPrefix
      || entry.startsWith(`${legacyPrefix}@`))
}

function isCanonicalNamedTuiPluginEntry(entry: unknown): boolean {
  const canonicalPrefix = `${PLUGIN_NAME}/${TUI_SUBPATH}`
  return typeof entry === "string" && (entry === canonicalPrefix || entry.startsWith(`${canonicalPrefix}@`))
}

export function detectServerPluginRegistration(): ServerPluginInfo {
  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  const configPath = existsSync(paths.configJsonc)
    ? paths.configJsonc
    : existsSync(paths.configJson)
      ? paths.configJson
      : null

  if (!configPath) {
    return { registered: false, configPath: null, entry: null, packageExportsTui: null }
  }

  try {
    const parsed = parseJsonc<OpenCodeConfigShape>(readFileSync(configPath, "utf-8"))
    const plugins = parsed.plugin ?? []
    const serverEntry = plugins.find(isServerPluginEntry)
    return {
      registered: serverEntry !== undefined,
      configPath,
      entry: serverEntry ?? null,
      packageExportsTui: serverEntry === undefined ? null : packageExportsTuiForServerEntry(serverEntry),
    }
  } catch (error) {
    log("[tui-plugin-config] Failed to inspect opencode plugin config", {
      configPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return { registered: false, configPath, entry: null, packageExportsTui: null }
  }
}

export function detectTuiPluginRegistration(): TuiPluginInfo {
  const tuiJsonPath = join(getOpenCodeConfigDir({ binary: "opencode" }), "tui.json")
  if (!existsSync(tuiJsonPath)) {
    return {
      registered: false,
      configPath: tuiJsonPath,
      exists: false,
      hasPackageTuiEntry: false,
      hasNamedTuiEntry: false,
      hasCanonicalNamedTuiEntry: false,
    }
  }

  try {
    const parsed = parseJsonc<TuiConfigShape>(readFileSync(tuiJsonPath, "utf-8"))
    const plugins = parsed.plugin ?? []
    return {
      registered: plugins.some(isTuiPluginEntry),
      configPath: tuiJsonPath,
      exists: true,
      hasPackageTuiEntry: plugins.some(isPackagePluginEntry),
      hasNamedTuiEntry: plugins.some(isNamedTuiPluginEntry),
      hasCanonicalNamedTuiEntry: plugins.some(isCanonicalNamedTuiPluginEntry),
    }
  } catch (error) {
    log("[tui-plugin-config] Failed to inspect TUI plugin config", {
      configPath: tuiJsonPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      registered: false,
      configPath: tuiJsonPath,
      exists: true,
      hasPackageTuiEntry: false,
      hasNamedTuiEntry: false,
      hasCanonicalNamedTuiEntry: false,
    }
  }
}

export async function checkTuiPluginConfig(): Promise<CheckResult> {
  const name = CHECK_NAMES[CHECK_IDS.TUI_PLUGIN]
  const server = detectServerPluginRegistration()
  const tui = detectTuiPluginRegistration()
  const issues: DoctorIssue[] = []
  const details: string[] = []

  if (server.configPath) details.push(`opencode.json: ${server.configPath}`)
  if (tui.configPath) details.push(`tui.json: ${tui.configPath}`)

  if (!server.registered && !tui.registered) {
    return {
      name,
      status: "skip",
      message: "Plugin not registered (server or TUI)",
      details: details.length > 0 ? details : undefined,
      issues,
    }
  }

  if (tui.hasNamedTuiEntry) {
    const exportStatus = server.packageExportsTui === null
      ? `may expose "${TUI_EXPORT_SUBPATH}", but the package could not be inspected`
      : server.packageExportsTui
        ? `does export "${TUI_EXPORT_SUBPATH}", but OpenCode resolves TUI exports from the package spec`
        : `does not export "${TUI_EXPORT_SUBPATH}"`
    const desiredEntry = server.entry ?? PLUGIN_NAME
    issues.push({
      title: "TUI plugin entry in tui.json is unresolvable",
      description:
        `tui.json contains "${PLUGIN_NAME}/${TUI_SUBPATH}" or "${LEGACY_PLUGIN_NAME}/${TUI_SUBPATH}". `
        + `The server package ${exportStatus}. `
        + "OpenCode installs the configured package spec before resolving the TUI export, so "
        + `the TUI config should use "${desiredEntry}" instead of the package subpath.`,
      fix: `Remove "${PLUGIN_NAME}/${TUI_SUBPATH}" and "${LEGACY_PLUGIN_NAME}/${TUI_SUBPATH}" from the "plugin" array in ${tui.configPath}, then add "${desiredEntry}".`,
      affects: ["TUI startup", "plugin loading"],
      severity: "warning",
    })
    return {
      name,
      status: "warn",
      message: "TUI plugin entry in tui.json is unresolvable",
      details: details.length > 0 ? details : undefined,
      issues,
    }
  }

  if (server.registered && server.packageExportsTui === false && tui.hasPackageTuiEntry) {
    issues.push({
      title: "TUI plugin package does not expose ./tui",
      description:
        `The installed ${server.entry ?? PLUGIN_NAME} package registered in opencode.json does not export "${TUI_EXPORT_SUBPATH}", `
        + "but tui.json contains the package entry for TUI loading.",
      fix: `Remove "${server.entry ?? PLUGIN_NAME}" from the "plugin" array in ${tui.configPath}, or update the installed package to a version that exports "${TUI_EXPORT_SUBPATH}".`,
      affects: ["TUI sidebar", "TUI commands"],
      severity: "warning",
    })
    return {
      name,
      status: "warn",
      message: "TUI plugin package does not expose ./tui",
      details: details.length > 0 ? details : undefined,
      issues,
    }
  }

  if (server.registered && !tui.registered) {
    if (server.packageExportsTui === false) {
      return {
        name,
        status: "pass",
        message: "Server plugin registered; TUI subpath not shipped by this package version",
        details: details.length > 0 ? details : undefined,
        issues,
      }
    }

    issues.push({
      title: "TUI plugin entry missing from tui.json",
      description:
        "The server plugin is registered in opencode.json, but the TUI plugin entry "
        + `("${server.entry ?? PLUGIN_NAME}") is missing from tui.json. The Roles · `
        + "Models sidebar section and TUI-only commands will not appear.",
      fix: "Re-run the installer (`npx oh-my-openagent install`) to auto-write tui.json, "
        + `or add "${server.entry ?? PLUGIN_NAME}" to the "plugin" array in ${tui.configPath}.`,
      affects: ["TUI sidebar", "TUI commands"],
      severity: "warning",
    })
    return {
      name,
      status: "warn",
      message: "TUI plugin entry missing from tui.json",
      details: details.length > 0 ? details : undefined,
      issues,
    }
  }

  if (!server.registered && tui.registered) {
    issues.push({
      title: "Server plugin entry missing from opencode.json",
      description:
        `The TUI plugin entry ("${PLUGIN_NAME}") is registered in tui.json, `
        + "but the server plugin (oh-my-openagent) is missing from opencode.json. "
        + "The plugin cannot function correctly without both halves — the server side "
        + "handles tool dispatch, hook execution, and SDK integration.",
      fix: "Re-run the installer (`npx oh-my-openagent install`) to auto-write opencode.json, "
        + `or add "${PLUGIN_NAME}" to the "plugin" array in ${server.configPath ?? "opencode.json"}.`,
      affects: ["tool dispatch", "hook execution", "SDK integration"],
      severity: "warning",
    })
    return {
      name,
      status: "warn",
      message: "Server plugin entry missing from opencode.json",
      details: details.length > 0 ? details : undefined,
      issues,
    }
  }

  return {
    name,
    status: "pass",
    message: "Server and TUI plugin entries are both registered",
    details: details.length > 0 ? details : undefined,
    issues,
  }
}
