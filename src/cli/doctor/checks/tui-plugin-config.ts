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

  if (server.registered && !tui.registered) {
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
