import { KNOWN_VARIANTS } from "./known-variants"

export type ParsedModelRoute = {
  readonly providerID: string
  readonly providers: string[]
  readonly modelID: string
  readonly variant?: string
}

export type ModelRouteParseError = {
  readonly kind:
    | "missing-provider"
    | "missing-model"
    | "empty-provider-in-pipe"
  readonly input: string
  readonly message: string
}

export type ModelRouteParseResult =
  | { readonly kind: "ok"; readonly route: ParsedModelRoute }
  | { readonly kind: "error"; readonly error: ModelRouteParseError }

export function parseVariantFromModelID(rawModelID: string): { modelID: string; variant?: string } {
  if (typeof rawModelID !== "string") {
    return { modelID: "" }
  }
  const trimmedModelID = rawModelID.trim()
  if (!trimmedModelID) {
    return { modelID: "" }
  }

  const parenthesizedVariant = trimmedModelID.match(/^(.*)\(([^()]+)\)\s*$/)
  if (parenthesizedVariant) {
    const modelID = parenthesizedVariant[1]?.trim() ?? ""
    const variant = parenthesizedVariant[2]?.trim()
    return variant ? { modelID, variant } : { modelID }
  }

  const spaceVariant = trimmedModelID.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i)
  if (spaceVariant) {
    const modelID = spaceVariant[1]?.trim() ?? ""
    const variant = spaceVariant[2]?.trim().toLowerCase()
    if (variant && KNOWN_VARIANTS.has(variant)) {
      return { modelID, variant }
    }
  }

  return { modelID: trimmedModelID }
}

function parseProviderPipe(rawProviderID: string): string[] | undefined {
  const providers = rawProviderID.split("|").map((provider) => provider.trim())
  if (providers.some((provider) => provider.length === 0)) {
    return undefined
  }
  return providers
}

function modelRouteError(
  kind: ModelRouteParseError["kind"],
  input: string,
  message: string,
): ModelRouteParseResult {
  return { kind: "error", error: { kind, input, message } }
}

export function parseModelRouteWithDiagnostics(model: string): ModelRouteParseResult {
  if (typeof model !== "string") {
    return modelRouteError("missing-provider", "", "Model route must be a string.")
  }
  const trimmedModel = model.trim()
  if (!trimmedModel) {
    return modelRouteError("missing-provider", model, "Model route is empty.")
  }

  const separatorIndex = trimmedModel.indexOf("/")
  if (separatorIndex === -1) {
    return modelRouteError(
      "missing-model",
      model,
      "Model route must include a provider before '/'. Use 'provider/model'.",
    )
  }

  const providerSegment = trimmedModel.slice(0, separatorIndex).trim()
  const rawModelID = trimmedModel.slice(separatorIndex + 1).trim()
  if (!providerSegment) {
    return modelRouteError(
      "missing-provider",
      model,
      "Model route is missing a provider before '/'. Use 'provider/model'.",
    )
  }
  if (!rawModelID) {
    return modelRouteError(
      "missing-model",
      model,
      "Model route is missing a model after '/'. Use 'provider/model'.",
    )
  }

  const providers = parseProviderPipe(providerSegment)
  if (!providers) {
    return modelRouteError(
      "empty-provider-in-pipe",
      model,
      "Model route provider list contains an empty provider before '/'. Use 'provider1|provider2/model'.",
    )
  }

  const parsedModel = parseVariantFromModelID(rawModelID)
  if (!parsedModel.modelID) {
    return modelRouteError(
      "missing-model",
      model,
      "Model route is missing a model after '/'. Use 'provider/model'.",
    )
  }

  const providerID = providers[0]
  if (!providerID) {
    return modelRouteError(
      "missing-provider",
      model,
      "Model route is missing a provider before '/'. Use 'provider/model'.",
    )
  }

  return parsedModel.variant
    ? {
        kind: "ok",
        route: { providerID, providers, modelID: parsedModel.modelID, variant: parsedModel.variant },
      }
    : {
        kind: "ok",
        route: { providerID, providers, modelID: parsedModel.modelID },
      }
}

export function parseModelRoute(model: string): ParsedModelRoute | undefined {
  const result = parseModelRouteWithDiagnostics(model)
  return result.kind === "ok" ? result.route : undefined
}

export function parseModelString(
  model: string,
): { providerID: string; modelID: string; variant?: string } | undefined {
  const route = parseModelRoute(model)
  if (!route) return undefined

  return route.variant
    ? { providerID: route.providerID, modelID: route.modelID, variant: route.variant }
    : { providerID: route.providerID, modelID: route.modelID }
}
