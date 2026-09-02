import { getOpenCodeConfigDirs } from "../shared"
import type { InstallConfigScope } from "./types"
import { setConfigDirOverride } from "./config-manager/config-context"

export interface InstallScopeRoots {
  readonly activeCustomDir: string
  readonly defaultGlobalDir: string
}

export type NonTuiInstallScopeResolution =
  | { readonly ok: true; readonly scope: null }
  | { readonly ok: true; readonly scope: InstallConfigScope; readonly roots: InstallScopeRoots }
  | { readonly ok: false; readonly error: string }

const SUPPORTED_SCOPES: readonly InstallConfigScope[] = ["active", "global"]

function isInstallConfigScope(value: string): value is InstallConfigScope {
  return (SUPPORTED_SCOPES as readonly string[]).includes(value)
}

export function resolveDistinctConfigRoots(): InstallScopeRoots | null {
  const dirs = getOpenCodeConfigDirs({ binary: "opencode", version: null })
  if (dirs.length !== 2) return null
  return { activeCustomDir: dirs[0], defaultGlobalDir: dirs[1] }
}

function formatScopeChoices(roots: InstallScopeRoots): string {
  return [
    `  active  register only in the active custom directory: ${roots.activeCustomDir}`,
    `  global  register only in the default global directory: ${roots.defaultGlobalDir}`,
  ].join("\n")
}

export function resolveNonTuiInstallScope(
  configScope: InstallConfigScope | undefined,
): NonTuiInstallScopeResolution {
  if (configScope !== undefined && !isInstallConfigScope(configScope)) {
    return {
      ok: false,
      error: `Invalid --config-scope value: ${configScope} (expected: active, global)`,
    }
  }

  const roots = resolveDistinctConfigRoots()
  if (!roots) return { ok: true, scope: null }
  if (!configScope) {
    return {
      ok: false,
      error:
        "A distinct custom OpenCode config directory is active; the registration scope must be chosen explicitly.\n" +
        formatScopeChoices(roots) +
        "\n  Pass --config-scope=active or --config-scope=global for non-interactive installs.",
    }
  }
  return { ok: true, scope: configScope, roots }
}

export function applyInstallConfigScope(scope: InstallConfigScope, roots: InstallScopeRoots): string {
  const configDir = scope === "active" ? roots.activeCustomDir : roots.defaultGlobalDir
  setConfigDirOverride(configDir)
  return configDir
}
