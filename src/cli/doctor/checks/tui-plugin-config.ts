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
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import type { CheckResult, DoctorIssue } from "../types"

const TUI_SUBPATH = "tui"
const TUI_EXPORT_KEY = "./tui"

interface PackageJsonExportsShape {
  exports?: unknown
}

// Locates the installed package.json that the doctor check should consult.
// Scoped to the configured OpenCode config dir so we never accidentally
// inspect the source repo's own package.json (when running from a dev tree)
// or the host's cache dir (when running tests). Returns null when no
// `node_modules/<pkg>/package.json` exists under the configured config dir.
function findInstalledPackageJsonInConfigDir(): string | null {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  for (const packageName of ACCEPTED_PACKAGE_NAMES) {
    const candidate = join(configDir, "node_modules", packageName, "package.json")
    if (existsSync(candidate)) return candidate
  }
  return null
}

// Returns true when the locally installed `oh-my-opencode` / `oh-my-openagent`
// package.json declares a `./tui` entry in its `exports` map. Returns false
// when the package exists but does not expose the subpath (matches the
// published 4.5.x tarball). Returns null when we cannot locate the installed
// package under the OpenCode config dir — in that case we keep the legacy
// warn behavior so we never regress users on a future version that ships
// ./tui.
//
// Background: when `./tui` is NOT exported, recommending users add
// `oh-my-openagent/tui` to tui.json triggers OpenCode's GitHub `owner/repo`
// fallback and hangs the TUI loader for ~140s (see #4643, #4598).
export function installedPackageExportsTui(): boolean | null {
  const installedPackagePath = findInstalledPackageJsonInConfigDir()
  if (!installedPackagePath) return null
  let parsed: PackageJsonExportsShape | null = null
  try {
    parsed = parseJsonc<PackageJsonExportsShape>(readFileSync(installedPackagePath, "utf-8"))
  } catch {
    return null
  }
  const exportsField = parsed?.exports
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) return false
  return Object.prototype.hasOwnProperty.call(exportsField, TUI_EXPORT_KEY)
}

interface OpenCodeConfigShape {
  plugin?: string[]
}

interface TuiConfigShape {
  plugin?: string[]
}

interface ServerPluginInfo {
  registered: boolean
  configPath: string | null
}

interface TuiPluginInfo {
  registered: boolean
  configPath: string | null
  exists: boolean
}

// Returns true if `entry` is a file:-URL pointing at a directory whose
// package.json declares one of our accepted package names. opencode-tui loads
// such entries via the `./tui` subpath export, so a `file:` entry already
// satisfies the TUI plugin registration even without an explicit
// `oh-my-openagent/tui` entry. Mirrors the helper used in
// add-tui-plugin-to-tui-config.ts during installation.
function isOurFilePluginEntry(entry: string): boolean {
  if (!entry.startsWith("file:")) return false
  let path = entry.slice("file:".length)
  if (path.startsWith("//")) path = path.slice(2)
  try {
    const pkgJsonPath = join(path, "package.json")
    if (!existsSync(pkgJsonPath)) return false
    const parsed = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name?: unknown }
    return typeof parsed.name === "string"
      && (ACCEPTED_PACKAGE_NAMES as readonly string[]).includes(parsed.name)
  } catch {
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
  const canonicalPrefix = `${PLUGIN_NAME}/${TUI_SUBPATH}`
  const legacyPrefix = `${LEGACY_PLUGIN_NAME}/${TUI_SUBPATH}`
  if (entry === canonicalPrefix || entry.startsWith(`${canonicalPrefix}@`)) return true
  if (entry === legacyPrefix || entry.startsWith(`${legacyPrefix}@`)) return true
  // file: entries pointing at our package already expose the ./tui subpath via
  // package.json `exports`, so the TUI plugin loads without a separate entry.
  if (entry.startsWith("file:") && isOurFilePluginEntry(entry)) return true
  return false
}

export function detectServerPluginRegistration(): ServerPluginInfo {
  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  const configPath = existsSync(paths.configJsonc)
    ? paths.configJsonc
    : existsSync(paths.configJson)
      ? paths.configJson
      : null

  if (!configPath) {
    return { registered: false, configPath: null }
  }

  try {
    const parsed = parseJsonc<OpenCodeConfigShape>(readFileSync(configPath, "utf-8"))
    const plugins = parsed.plugin ?? []
    return { registered: plugins.some(isServerPluginEntry), configPath }
  } catch {
    return { registered: false, configPath }
  }
}

export function detectTuiPluginRegistration(): TuiPluginInfo {
  const tuiJsonPath = join(getOpenCodeConfigDir({ binary: "opencode" }), "tui.json")
  if (!existsSync(tuiJsonPath)) {
    return { registered: false, configPath: tuiJsonPath, exists: false }
  }

  try {
    const parsed = parseJsonc<TuiConfigShape>(readFileSync(tuiJsonPath, "utf-8"))
    const plugins = parsed.plugin ?? []
    return { registered: plugins.some(isTuiPluginEntry), configPath: tuiJsonPath, exists: true }
  } catch {
    return { registered: false, configPath: tuiJsonPath, exists: true }
  }
}

export async function checkTuiPluginConfig(): Promise<CheckResult> {
  const name = CHECK_NAMES[CHECK_IDS.TUI_PLUGIN]
  const server = detectServerPluginRegistration()
  const tui = detectTuiPluginRegistration()
  const issues: DoctorIssue[] = []
  const details: string[] = []
  const exportsTui = installedPackageExportsTui()

  if (server.configPath) details.push(`opencode.json: ${server.configPath}`)
  if (tui.configPath) details.push(`tui.json: ${tui.configPath}`)
  if (exportsTui === false) details.push("package exports: ./tui not declared")

  if (!server.registered && !tui.registered) {
    return {
      name,
      status: "skip",
      message: "Plugin not registered (server or TUI)",
      details: details.length > 0 ? details : undefined,
      issues,
    }
  }

  if (server.registered && !tui.registered) {
    // If the installed package does not expose `./tui`, recommending users add
    // the entry would actively break their setup: opencode-tui would fall back
    // to GitHub `owner/repo` resolution and hang ~140s. See #4643 / #4598.
    if (exportsTui === false) {
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

  // Both registered. If the installed package does not actually export `./tui`,
  // the entry the user has in tui.json is unresolvable: opencode-tui falls back
  // to GitHub `owner/repo` and hangs ~140s on plugin load. See #4643 / #4598.
  if (exportsTui === false) {
    issues.push({
      title: "TUI plugin entry in tui.json is unresolvable",
      description:
        `The TUI plugin entry ("${PLUGIN_NAME}/${TUI_SUBPATH}") is registered in `
        + `${tui.configPath ?? "tui.json"}, but the installed package does not declare `
        + `a "./tui" entry in its package.json "exports". OpenCode falls back to `
        + "interpreting it as a GitHub `owner/repo` shorthand and hangs ~140s "
        + "on plugin load before failing with NpmInstallFailedError.",
      fix:
        `Remove "${PLUGIN_NAME}/${TUI_SUBPATH}" (and any legacy `
        + `"${LEGACY_PLUGIN_NAME}/${TUI_SUBPATH}") from the "plugin" array in `
        + `${tui.configPath ?? "tui.json"}. If tui.json then has no other entries, `
        + "you can delete the file entirely.",
      affects: ["plugin loading", "OpenCode startup time"],
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

  return {
    name,
    status: "pass",
    message: "Server and TUI plugin entries are both registered",
    details: details.length > 0 ? details : undefined,
    issues,
  }
}
