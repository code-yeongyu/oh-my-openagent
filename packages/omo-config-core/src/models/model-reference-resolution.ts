import type {
  OmoAgentDef,
  OmoAgentModelEntry,
  OmoCategoryConfig,
  OmoConfig,
  OmoFallbackModelObject,
  OmoFallbackModels,
  OmoModelCatalog,
  OmoModelCatalogEntry,
  OmoReasoningEffort,
} from "../schema"
import { findModelCatalogCycles } from "./model-catalog-cycles"

export type OmoModelReferenceDiagnostic = {
  readonly kind: "model_catalog_cycle"
  readonly message: string
  readonly path: string
}

export type ResolveModelReferencesResult = {
  readonly diagnostics: readonly OmoModelReferenceDiagnostic[]
  readonly view: OmoConfig
}

function catalogReference(
  model: string,
  variant: string | undefined,
  reasoningEffort: OmoReasoningEffort | undefined,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoModelCatalogEntry | undefined {
  const entry = catalog?.[model]
  if (entry === undefined || cycleNames.has(model)) return undefined

  return {
    model: entry.model,
    ...(variant === undefined && entry.variant !== undefined ? { variant: entry.variant } : variant !== undefined ? { variant } : {}),
    ...(reasoningEffort === undefined && entry.reasoningEffort !== undefined
      ? { reasoningEffort: entry.reasoningEffort }
      : reasoningEffort !== undefined ? { reasoningEffort } : {}),
  }
}

function resolveAgentModelEntry(
  entry: OmoAgentModelEntry,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoAgentModelEntry {
  if (typeof entry === "string") {
    const resolved = catalogReference(entry, undefined, undefined, catalog, cycleNames)
    if (resolved === undefined) return entry
    return resolved.variant === undefined && resolved.reasoningEffort === undefined ? resolved.model : resolved
  }

  const resolved = catalogReference(entry.model, entry.variant, entry.reasoningEffort, catalog, cycleNames)
  if (resolved === undefined) return entry
  return {
    ...entry,
    model: resolved.model,
    ...(entry.variant === undefined && resolved.variant !== undefined ? { variant: resolved.variant } : {}),
    ...(entry.reasoningEffort === undefined && resolved.reasoningEffort !== undefined
      ? { reasoningEffort: resolved.reasoningEffort }
      : {}),
  }
}

function resolveFallbackModelEntry(
  entry: string | OmoFallbackModelObject,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): string | OmoFallbackModelObject {
  if (typeof entry === "string") {
    const resolved = catalogReference(entry, undefined, undefined, catalog, cycleNames)
    if (resolved === undefined) return entry
    return resolved.variant === undefined && resolved.reasoningEffort === undefined ? resolved.model : resolved
  }

  const resolved = catalogReference(entry.model, entry.variant, entry.reasoningEffort, catalog, cycleNames)
  if (resolved === undefined) return entry
  return {
    ...entry,
    model: resolved.model,
    ...(entry.variant === undefined && resolved.variant !== undefined ? { variant: resolved.variant } : {}),
    ...(entry.reasoningEffort === undefined && resolved.reasoningEffort !== undefined
      ? { reasoningEffort: resolved.reasoningEffort }
      : {}),
  }
}

function resolveFallbackModels(
  fallbackModels: OmoFallbackModels | undefined,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoFallbackModels | undefined {
  if (fallbackModels === undefined) return undefined
  if (typeof fallbackModels !== "string") {
    return fallbackModels.map((entry) => resolveFallbackModelEntry(entry, catalog, cycleNames))
  }

  const resolved = catalogReference(fallbackModels, undefined, undefined, catalog, cycleNames)
  if (resolved === undefined || (resolved.variant === undefined && resolved.reasoningEffort === undefined)) {
    return resolved?.model ?? fallbackModels
  }
  return [resolved]
}

function resolveAgentDefinition(
  definition: OmoAgentDef,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoAgentDef {
  const resolvedModel = definition.model === undefined
    ? undefined
    : catalogReference(definition.model, definition.variant, definition.reasoningEffort, catalog, cycleNames)

  return {
    ...definition,
    ...(resolvedModel === undefined ? {} : { model: resolvedModel.model }),
    ...(definition.variant === undefined && resolvedModel?.variant !== undefined ? { variant: resolvedModel.variant } : {}),
    ...(definition.reasoningEffort === undefined && resolvedModel?.reasoningEffort !== undefined
      ? { reasoningEffort: resolvedModel.reasoningEffort }
      : {}),
    ...(definition.models === undefined
      ? {}
      : { models: definition.models.map((entry) => resolveAgentModelEntry(entry, catalog, cycleNames)) }),
  }
}

function resolveCategoryDefinition(
  definition: OmoCategoryConfig,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoCategoryConfig {
  const resolvedModel = definition.model === undefined
    ? undefined
    : catalogReference(definition.model, definition.variant, definition.reasoningEffort, catalog, cycleNames)

  return {
    ...definition,
    ...(resolvedModel === undefined ? {} : { model: resolvedModel.model }),
    ...(definition.variant === undefined && resolvedModel?.variant !== undefined ? { variant: resolvedModel.variant } : {}),
    ...(definition.reasoningEffort === undefined && resolvedModel?.reasoningEffort !== undefined
      ? { reasoningEffort: resolvedModel.reasoningEffort }
      : {}),
    ...(definition.fallback_models === undefined
      ? {}
      : { fallback_models: resolveFallbackModels(definition.fallback_models, catalog, cycleNames) }),
  }
}

function cycleDiagnostics(catalog: OmoModelCatalog | undefined): readonly OmoModelReferenceDiagnostic[] {
  if (catalog === undefined) return []
  return findModelCatalogCycles(catalog).map((name) => ({
    kind: "model_catalog_cycle",
    message: catalog[name]?.model === name
      ? `Model catalog entry "${name}" references itself`
      : `Model catalog entry "${name}" participates in a reference cycle`,
    path: `models.${name}.model`,
  }))
}

export function resolveModelReferences(view: OmoConfig): ResolveModelReferencesResult {
  const diagnostics = cycleDiagnostics(view.models)
  const cycleNames = new Set<string>()
  for (const diagnostic of diagnostics) {
    const name = diagnostic.path.split(".")[1]
    if (name !== undefined) cycleNames.add(name)
  }
  const agents = view.agents === undefined
    ? undefined
    : Object.fromEntries(Object.entries(view.agents).map(([name, definition]) => [
      name,
      resolveAgentDefinition(definition, view.models, cycleNames),
    ]))
  const categories = view.categories === undefined
    ? undefined
    : Object.fromEntries(Object.entries(view.categories).map(([name, definition]) => [
      name,
      resolveCategoryDefinition(definition, view.models, cycleNames),
    ]))

  return {
    diagnostics,
    view: {
      ...view,
      ...(agents === undefined ? {} : { agents }),
      ...(categories === undefined ? {} : { categories }),
    },
  }
}
