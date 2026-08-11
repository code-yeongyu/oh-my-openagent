import {
  loadOmoConfig,
  resolveModelReferences,
  type LoadOmoConfigOptions,
  type LoadOmoConfigResult,
  type OmoConfig,
  type OmoConfigDiagnostic,
  type OmoModelReferenceDiagnostic,
} from "@oh-my-opencode/omo-config-core"

export type OmpConfigDiagnostic = OmoConfigDiagnostic | OmoModelReferenceDiagnostic

export type OmpOmoConfigResult = Omit<LoadOmoConfigResult, "config" | "diagnostics"> & {
  readonly config: OmoConfig
  readonly diagnostics: readonly OmpConfigDiagnostic[]
}

/**
 * Loads the profile-selected OMP view and expands shared model catalog entries for task consumers.
 *
 * omo-config-core accepts an "omp" harness id (OmoHarnessId = "opencode" | "senpi" | "codex" | "omp"),
 * so the OMP adapter folds its own `[omp]` config layer.
 */
export function loadOmpOmoConfig(options: LoadOmoConfigOptions = {}): OmpOmoConfigResult {
  const { harness: _ignoredHarness, ...loadOptions } = options
  const loaded = loadOmoConfig({ ...loadOptions, harness: "omp" })
  const resolvedModels = resolveModelReferences(loaded.config)
  return {
    ...loaded,
    config: resolvedModels.view,
    diagnostics: [...loaded.diagnostics, ...resolvedModels.diagnostics],
  }
}

// Verbatim ports of sibling components (e.g. fallback-architect) still import the senpi-spelled
// names; alias them so both spellings resolve to the same OMP loader.
export const loadSenpiOmoConfig = loadOmpOmoConfig
export type SenpiOmoConfigResult = OmpOmoConfigResult
