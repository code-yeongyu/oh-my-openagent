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
    diagnostics: [
      ...loaded.diagnostics,
      ...resolvedModels.diagnostics,
      ...unresolvableAgentModelDiagnostics(resolvedModels.view),
    ],
  }
}

// Native resolves an agent model only as `provider/model` (senpi-task agent-model-registry parseModel);
// a bare id that is not a `models` catalog key is skipped there, and the builtin chain runs instead (#11763).
// Catalog keys are already expanded in `view`, so any bare id left here is one Native will ignore.
function unresolvableAgentModelDiagnostics(view: OmoConfig): readonly OmoModelReferenceDiagnostic[] {
  const diagnostics: OmoModelReferenceDiagnostic[] = []
  for (const [name, definition] of Object.entries(view.agents ?? {})) {
    if (definition === undefined) continue
    if (definition.model !== undefined && !isProviderModel(definition.model)) {
      diagnostics.push(bareAgentModel(`agents.${name}.model`, definition.model))
    }
    definition.models?.forEach((entry, index) => {
      const model = typeof entry === "string" ? entry : entry.model
      if (!isProviderModel(model)) diagnostics.push(bareAgentModel(`agents.${name}.models.${index}`, model))
    })
  }
  return diagnostics
}

function isProviderModel(model: string): boolean {
  const separator = model.indexOf("/")
  return separator > 0 && separator < model.length - 1
}

function bareAgentModel(path: string, model: string): OmoModelReferenceDiagnostic {
  return {
    kind: "validation",
    path,
    message: `${path}: "${model}" is ignored because it names no provider; write it as provider/model (for example anthropic/${model}) or as a key of \`models\`.`,
  }
}
