import {
  loadOmoConfig,
  resolveModelReferences,
  type LoadOmoConfigOptions,
  type LoadOmoConfigResult,
  type OmoConfig,
  type OmoConfigDiagnostic,
  type OmoModelReferenceDiagnostic,
} from "@oh-my-opencode/omo-config-core"

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
  return {
    ...loaded,
    config: resolvedModels.view,
    diagnostics: [...loaded.diagnostics, ...resolvedModels.diagnostics],
  }
}
