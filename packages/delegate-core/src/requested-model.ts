// Per-call model override requested by the orchestrating agent at delegation time.
// Pure + dependency-injected (no IO): parses a "provider/model[ variant]" string,
// applies an explicit reasoning/variant override, and gates the result against the
// set of connected/available models. Config defaults still apply when no model is
// requested (kind: "none").

export type RequestedModelInput = {
  readonly model?: string
  readonly reasoningEffort?: string
}

export type RequestedModelConfig = {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: string
}

export type RequestedModelResolution =
  | { readonly kind: "none" }
  | { readonly kind: "resolved"; readonly model: RequestedModelConfig; readonly matched: string }
  | { readonly kind: "error"; readonly message: string }

export type RequestedModelDeps = {
  readonly availableModels: ReadonlySet<string>
  readonly parseModelString: (
    model: string,
  ) => { providerID: string; modelID: string; variant?: string } | undefined
  readonly fuzzyMatchModel: (
    target: string,
    available: Set<string>,
    providers?: string[],
  ) => string | null
}

const MAX_SAMPLE = 8

function sampleAvailable(available: ReadonlySet<string>): string {
  return Array.from(available).sort().slice(0, MAX_SAMPLE).join(", ")
}

export function resolveRequestedModelOverride(
  input: RequestedModelInput,
  deps: RequestedModelDeps,
): RequestedModelResolution {
  const requested = input.model?.trim()
  if (!requested) {
    return { kind: "none" }
  }

  const parsed = deps.parseModelString(requested)
  if (!parsed) {
    return {
      kind: "error",
      message: `Invalid model "${requested}". Expected "provider/model" (optionally "provider/model variant"), e.g. "openai/gpt-5.5" or "openai/gpt-5.5 xhigh".`,
    }
  }

  const explicitReasoning = input.reasoningEffort?.trim()
  const variant = explicitReasoning && explicitReasoning.length > 0 ? explicitReasoning : parsed.variant
  const full = `${parsed.providerID}/${parsed.modelID}`

  // Cold cache: we genuinely cannot verify availability. Do not block the first
  // delegation — pass the parsed model through and let runtime resolution handle it.
  if (deps.availableModels.size === 0) {
    return {
      kind: "resolved",
      matched: full,
      model: variant ? { ...parsed, variant } : { providerID: parsed.providerID, modelID: parsed.modelID },
    }
  }

  const matched = deps.fuzzyMatchModel(full, new Set(deps.availableModels), [parsed.providerID])
  if (!matched) {
    return {
      kind: "error",
      message: `Model "${full}" is not available among connected providers. Available models include: ${sampleAvailable(deps.availableModels)}.`,
    }
  }

  const separatorIndex = matched.indexOf("/")
  const providerID = separatorIndex === -1 ? parsed.providerID : matched.slice(0, separatorIndex)
  const modelID = separatorIndex === -1 ? matched : matched.slice(separatorIndex + 1)

  return {
    kind: "resolved",
    matched,
    model: variant ? { providerID, modelID, variant } : { providerID, modelID },
  }
}
