import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  ACCEPTED_PACKAGE_NAMES,
  LEGACY_PLUGIN_NAME,
  PLUGIN_NAME,
  getOpenCodeConfigDir,
  getOpenCodeConfigPaths,
  parseJsonc,
} from "../../../shared"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"

const TUI_SUBPATH = "tui"
const TUI_EXPORT_SUBPATH = `./${TUI_SUBPATH}`

interface OpenCodeConfigShape {
  plugin?: string[]
}

interface TuiConfigShape {
  plugin?: string[]
}

interface ServerPluginInfo {
  registered: boolean
  configPath: string | null
  packageExportsTui: boolean | null
}

interface TuiPluginInfo {
  registered: boolean
  configPath: string | null
  exists: boolean
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
    void error
    return null
  }
}

function packageNameFromServerEntry(entry: string): string | null {
  if (entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)) return PLUGIN_NAME
  if (entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) return LEGACY_PLUGIN_NAME
  return null
}

function packageExportsTuiForServerEntry(entry: string): boolean | null {
  if (entry.startsWith("file:")) return packageJsonExportsTui(fileEntryPackageJsonPath(entry))

  const packageName = packageNameFromServerEntry(entry)
  if (packageName === null) return null

  return packageJsonExportsTui(join(getOpenCodeConfigDir({ binary: "opencode" }), "node_modules", packageName, "package.json"))
}

// Returns true if `entry` is a file:-URL pointing at a directory whose
// package.json declares one of our accepted package names. opencode-tui loads
// such entries via the `./tui` subpath export, so a `file:` entry already
// satisfies the TUI plugin registration even without an explicit
// `oh-my-openagent/tui` entry. Mirrors the helper used in
// add-tui-plugin-to-tui-config.ts during installation.
function isOurFilePluginEntry(entry: string): boolean {
  if (!entry.startsWith("file:")) return false
  try {
    const pkgJsonPath = fileEntryPackageJsonPath(entry)
    if (!existsSync(pkgJsonPath)) return false
    const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name?: unknown }
    return typeof parsed.name === "string"
      && (ACCEPTED_PACKAGE_NAMES as readonly string[]).includes(parsed.name)
  } catch (error) {
    void error
    return false
  }
}

function isServerPluginEntry(entry: string): boolean {
  if (entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)) return true
  if (entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) return true
  if (entry.startsWith("file:") && isOurFilePluginEntry(entry)) return true
  return false
}

function isTuiPluginEntry(entry: string): boolean {
  if (isNamedTuiPluginEntry(entry)) return true
  // file: entries pointing at our package already expose the ./tui subpath via
  // package.json `exports`, so the TUI plugin loads without a separate entry.
  if (entry.startsWith("file:") && isOurFilePluginEntry(entry)) return true
  return false
}

function isNamedTuiPluginEntry(entry: string): boolean {
  const canonicalPrefix = `${PLUGIN_NAME}/${TUI_SUBPATH}`
  const legacyPrefix = `${LEGACY_PLUGIN_NAME}/${TUI_SUBPATH}`
  if (entry === canonicalPrefix || entry.startsWith(`${canonicalPrefix}@`)) return true
  if (entry === legacyPrefix || entry.startsWith(`${legacyPrefix}@`)) return true
  return false
}

function isCanonicalNamedTuiPluginEntry(entry: string): boolean {
  const canonicalPrefix = `${PLUGIN_NAME}/${TUI_SUBPATH}`
  return entry === canonicalPrefix || entry.startsWith(`${canonicalPrefix}@`)
}

export function detectServerPluginRegistration(): ServerPluginInfo {
  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  const configPath = existsSync(paths.configJsonc)
    ? paths.configJsonc
    : existsSync(paths.configJson)
      ? paths.configJson
      : null

  if (!configPath) {
    return { registered: false, configPath: null, packageExportsTui: null }
  }

  try {
    const parsed = parseJsonc<OpenCodeConfigShape>(readFileSync(configPath, "utf-8"))
    const plugins = parsed.plugin ?? []
    const serverEntry = plugins.find(isServerPluginEntry)
    return {
      registered: serverEntry !== undefined,
      configPath,
      packageExportsTui: serverEntry === undefined ? null : packageExportsTuiForServerEntry(serverEntry),
    }
  } catch (error) {
    void error
    return { registered: false, configPath, packageExportsTui: null }
  }
}

export function detectTuiPluginRegistration(): TuiPluginInfo {
  const tuiJsonPath = join(getOpenCodeConfigDir({ binary: "opencode" }), "tui.json")
  if (!existsSync(tuiJsonPath)) {
    return { registered: false, configPath: tuiJsonPath, exists: false, hasNamedTuiEntry: false, hasCanonicalNamedTuiEntry: false }
  }

  try {
    const parsed = parseJsonc<TuiConfigShape>(readFileSync(tuiJsonPath, "utf-8"))
    const plugins = parsed.plugin ?? []
    return {
      registered: plugins.some(isTuiPluginEntry),
      configPath: tuiJsonPath,
      exists: true,
      hasNamedTuiEntry: plugins.some(isNamedTuiPluginEntry),
      hasCanonicalNamedTuiEntry: plugins.some(isCanonicalNamedTuiPluginEntry),
    }
  } catch (error) {
    void error
    return { registered: false, configPath: tuiJsonPath, exists: true, hasNamedTuiEntry: false, hasCanonicalNamedTuiEntry: false }
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

  const hasKnownBrokenNamedTuiEntry = server.packageExportsTui === false && tui.hasNamedTuiEntry
  const hasUninspectableCanonicalTuiEntry = server.packageExportsTui === null && tui.hasCanonicalNamedTuiEntry
  if (server.registered && (hasKnownBrokenNamedTuiEntry || hasUninspectableCanonicalTuiEntry)) {
    const exportStatus = server.packageExportsTui === null
      ? `could not be inspected for a "${TUI_EXPORT_SUBPATH}" export`
      : `does not export "${TUI_EXPORT_SUBPATH}"`
    issues.push({
      title: "TUI plugin entry in tui.json is unresolvable",
      description:
        `The installed ${PLUGIN_NAME} package registered in opencode.json ${exportStatus}, `
        + `but tui.json contains "${PLUGIN_NAME}/${TUI_SUBPATH}". `
        + "OpenCode TUI may try to resolve that package subpath as a GitHub repository and fail.",
      fix: `Remove "${PLUGIN_NAME}/${TUI_SUBPATH}" or "${LEGACY_PLUGIN_NAME}/${TUI_SUBPATH}" from the "plugin" array in ${tui.configPath}.`,
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
        + `("${PLUGIN_NAME}/${TUI_SUBPATH}") is missing from tui.json. The Roles · `
        + "Models sidebar section and TUI-only commands will not appear.",
      fix: "Re-run the installer (`npx oh-my-openagent install`) to auto-write tui.json, "
        + `or add "${PLUGIN_NAME}/${TUI_SUBPATH}" to the "plugin" array in ${tui.configPath}.`,
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
        `The TUI plugin entry ("${PLUGIN_NAME}/${TUI_SUBPATH}") is registered in tui.json, `
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
