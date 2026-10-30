import { displayOmoConfigPath, MERGED_OMO_CONFIG_PATH, type OmoConfigDiagnostic, type OmoModelReferenceDiagnostic } from "@oh-my-opencode/omo-config-core"

import { OhMyOpenCodeConfigSchema } from "../../config/schema"
import { findUnknownKeyPaths } from "../../plugin-config/unknown-key-diagnostics"
import type { OmoOpenCodeConfigView } from "../../plugin-config/omo-config-chain"
import type { PrunedPluginView } from "../../config/prune-plugin-view"
import type { ModelMapDiagnostic } from "./types"

const MESSAGES: Readonly<Record<string, string>> = {
  "deprecated-keys": "Deprecated configuration keys are still accepted.",
  "invalid-value": "Invalid configuration values were ignored.",
  parse: "Invalid JSONC; this source was rejected.",
  profile: "Requested profile does not exist; base configuration was loaded.",
  read: "Configuration source could not be read.",
  "unknown-keys": "Unknown configuration keys were ignored.",
  validation: "Configuration validation failed.",
  model_catalog_cycle: "Model catalog contains a reference cycle.",
}

export function projectDiagnostic(diagnostic: OmoConfigDiagnostic | OmoModelReferenceDiagnostic, sourcePaths: ReadonlySet<string>): ModelMapDiagnostic {
  const source = sourcePaths.has(diagnostic.path)
  return {
    kind: diagnostic.kind,
    severity: diagnostic.kind === "deprecated-keys" || diagnostic.kind === "unknown-keys" ? "warning" : "error",
    scope: source ? "source" : "merged",
    path: source ? diagnostic.path : null,
    issuePaths: diagnostic.issuePaths ?? (source || diagnostic.path === MERGED_OMO_CONFIG_PATH ? [] : [diagnostic.path]),
    // Loader messages can contain invalid values or provider data. Publish only kind and key paths.
    message: MESSAGES[diagnostic.kind] ?? "Configuration diagnostic.",
  }
}

export function pluginDiagnostics(view: OmoOpenCodeConfigView, pruned: PrunedPluginView, homeDir: string | undefined): readonly ModelMapDiagnostic[] {
  const prefix = `config: ${displayOmoConfigPath(view.path, homeDir)}: `
  const suffix = " ignored (invalid value)"
  const dropped = pruned.warnings.map((warning): ModelMapDiagnostic => ({
    kind: "invalid-value",
    severity: "error",
    scope: "source",
    path: view.path,
    issuePaths: [warning.slice(prefix.length, -suffix.length)],
    message: MESSAGES["invalid-value"] ?? "Configuration diagnostic.",
  }))
  const unknownPaths = view.keyPrefix.endsWith("[opencode].")
    ? findUnknownKeyPaths(OhMyOpenCodeConfigSchema, view.config).map((path) => `${view.keyPrefix}${path.map(String).join(".")}`)
    : []
  return [
    ...(unknownPaths.length === 0 ? [] : [{
      kind: "unknown-keys",
      severity: "warning" as const,
      scope: "source" as const,
      path: view.path,
      issuePaths: unknownPaths,
      message: MESSAGES["unknown-keys"] ?? "Configuration diagnostic.",
    }]),
    ...dropped,
    ...pruned.issues.map((issue): ModelMapDiagnostic => ({
      kind: "validation",
      severity: "error",
      scope: "source" as const,
      path: view.path,
      issuePaths: [`${view.keyPrefix}${issue.path.map(String).join(".")}`],
      message: MESSAGES.validation ?? "Configuration diagnostic.",
    })),
  ]
}
