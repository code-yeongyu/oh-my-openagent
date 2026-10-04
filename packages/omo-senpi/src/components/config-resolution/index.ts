import { homedir } from "node:os"

import {
  loadOmoConfig,
  resolveModelReferences,
  type LoadOmoConfigOptions,
  type LoadOmoConfigResult,
  type OmoConfig,
  type OmoConfigDiagnostic,
  type OmoModelReferenceDiagnostic,
} from "@oh-my-opencode/omo-config-core"
import { resolvePromptAppend } from "@oh-my-opencode/senpi-task"

export type SenpiConfigDiagnostic = OmoConfigDiagnostic | OmoModelReferenceDiagnostic

export type SenpiOmoConfigResult = Omit<LoadOmoConfigResult, "config" | "diagnostics"> & {
  readonly config: OmoConfig
  readonly diagnostics: readonly SenpiConfigDiagnostic[]
}

/** Loads the profile-selected Senpi view and expands shared model catalog entries for task consumers. */
export function loadSenpiOmoConfig(options: LoadOmoConfigOptions = {}): SenpiOmoConfigResult {
  const { harness: _ignoredHarness, ...loadOptions } = options
  const loaded = loadOmoConfig({ ...loadOptions, harness: "senpi" })
  const resolvedModels = resolveModelReferences(loaded.config)
  const config = resolveAgentPromptAppends(resolvedModels.view, {
    projectDir: options.cwd ?? process.cwd(),
    homeDir: options.env?.HOME ?? options.env?.USERPROFILE ?? homedir(),
  })
  return {
    ...loaded,
    config,
    diagnostics: [...loaded.diagnostics, ...resolvedModels.diagnostics],
  }
}

// OpenCode-edition parity (`mergeAgentConfig` resolves `prompt_append` at merge time): expand
// `file://` references here, at the one config seam every live consumer reads, so a reference
// never reaches a child spawn verbatim. Non-URI values pass through untouched.
function resolveAgentPromptAppends(
  config: OmoConfig,
  roots: { readonly projectDir: string; readonly homeDir: string },
): OmoConfig {
  const agents = config.agents
  if (agents === undefined) return config
  let changed = false
  const resolved: Record<string, (typeof agents)[string]> = {}
  for (const [name, definition] of Object.entries(agents)) {
    const value = definition.prompt_append
    if (value === undefined || !value.startsWith("file://")) {
      resolved[name] = definition
      continue
    }
    resolved[name] = { ...definition, prompt_append: resolvePromptAppend(value, roots) }
    changed = true
  }
  return changed ? { ...config, agents: resolved } : config
}
