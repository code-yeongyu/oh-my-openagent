import { homedir } from "node:os"
import { join } from "node:path"

import {
  loadOmoConfig,
  resolveModelReferences,
  type LoadOmoConfigOptions,
  type LoadOmoConfigResult,
  type OmoConfig,
  type OmoConfigDiagnostic,
  type OmoModelReferenceDiagnostic,
} from "@oh-my-opencode/omo-config-core"
import { findPromptAppendConfigPath, promptAppendFailureMessage, resolvePromptAppend } from "@oh-my-opencode/senpi-task"

export type SenpiPromptAppendDiagnostic = {
  readonly kind: "prompt_append"
  readonly message: string
  readonly path: string
}

export type SenpiConfigDiagnostic = OmoConfigDiagnostic | OmoModelReferenceDiagnostic | SenpiPromptAppendDiagnostic

export type SenpiOmoConfigResult = Omit<LoadOmoConfigResult, "config" | "diagnostics"> & {
  readonly config: OmoConfig
  readonly diagnostics: readonly SenpiConfigDiagnostic[]
}

/** Loads the profile-selected Senpi view and expands shared model catalog entries for task consumers. */
export function loadSenpiOmoConfig(options: LoadOmoConfigOptions = {}): SenpiOmoConfigResult {
  const { harness: _ignoredHarness, ...loadOptions } = options
  const loaded = loadOmoConfig({ ...loadOptions, harness: "senpi" })
  const resolvedModels = resolveModelReferences(loaded.config)
  const homeDir = options.env?.HOME ?? options.env?.USERPROFILE ?? process.env.HOME ?? process.env.USERPROFILE ?? homedir()
  const resolvedAppends = resolveAgentPromptAppends(
    resolvedModels.view,
    { projectDir: options.cwd ?? process.cwd(), homeDir },
    loaded.layers,
    join(homeDir, ".omo", "omo.jsonc"),
  )
  return {
    ...loaded,
    config: resolvedAppends.config,
    diagnostics: [...loaded.diagnostics, ...resolvedModels.diagnostics, ...resolvedAppends.diagnostics],
  }
}

// OpenCode-edition parity (`mergeAgentConfig` resolves `prompt_append` at merge time): expand
// `file://` references here, at the one config seam every live consumer reads, so a reference never
// reaches a child spawn verbatim. A failure is reported as a diagnostic and the agent's append is
// dropped, so one broken value neither stops the others from loading nor replaces the base persona.
function resolveAgentPromptAppends(
  config: OmoConfig,
  roots: { readonly projectDir: string; readonly homeDir: string },
  layers: LoadOmoConfigResult["layers"],
  fallbackPath: string,
): { readonly config: OmoConfig; readonly diagnostics: readonly SenpiPromptAppendDiagnostic[] } {
  const agents = config.agents
  if (agents === undefined) return { config, diagnostics: [] }
  const diagnostics: SenpiPromptAppendDiagnostic[] = []
  const resolved: Record<string, (typeof agents)[string]> = {}
  for (const [name, definition] of Object.entries(agents)) {
    const value = definition.prompt_append
    if (value === undefined || !value.startsWith("file://")) {
      resolved[name] = definition
      continue
    }
    const resolution = resolvePromptAppend(value, roots)
    if (resolution.ok) {
      resolved[name] = { ...definition, prompt_append: resolution.value }
      continue
    }
    diagnostics.push({
      kind: "prompt_append",
      message: promptAppendFailureMessage(name, value, resolution.reason, resolution.targetPath),
      path: findPromptAppendConfigPath(layers, name, value, fallbackPath),
    })
    const { prompt_append: _unresolved, ...base } = definition
    resolved[name] = base
  }
  return { config: { ...config, agents: resolved }, diagnostics }
}
