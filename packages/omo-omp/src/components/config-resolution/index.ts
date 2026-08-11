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

/** Loads the profile-selected OMP view and expands shared model catalog entries for task consumers. */
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
