import type {
  OmoAgentDef,
  OmoAgentModelEntry,
  OmoCategoryConfig,
  OmoConfig,
  OmoFallbackModelObject,
  OmoFallbackModels,
  OmoModelCatalog,
  OmoModelCatalogEntry,
  OmoModelProfile,
  OmoReasoning,
} from "../schema"
import { findModelCatalogCycles } from "./model-catalog-cycles"

export type OmoModelReferenceDiagnostic = {
  readonly kind: "model_catalog_cycle" | "validation"
  readonly message: string
  readonly path: string
  readonly issuePaths?: readonly string[]
}

type OmoModelChainOwner = {
  readonly models?: readonly (string | OmoFallbackModelObject)[]
}

export type ResolveModelReferencesResult = {
  readonly diagnostics: readonly OmoModelReferenceDiagnostic[]
  readonly view: OmoConfig
}

function catalogReference(
  model: string,
  reasoning: OmoReasoning | undefined,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoModelCatalogEntry | undefined {
  const entry = catalog?.[model]
  if (entry === undefined || cycleNames.has(model)) return undefined

  return {
    model: entry.model,
    ...(reasoning === undefined && entry.reasoning !== undefined
      ? { reasoning: entry.reasoning }
      : reasoning !== undefined ? { reasoning } : {}),
  }
}

function resolveModelEntry(
  entry: OmoAgentModelEntry | string | OmoFallbackModelObject,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoAgentModelEntry {
  if (typeof entry === "string") {
    const resolved = catalogReference(entry, undefined, catalog, cycleNames)
    if (resolved === undefined) return entry
    return resolved.reasoning === undefined ? resolved.model : resolved
  }

  const resolved = catalogReference(entry.model, entry.reasoning, catalog, cycleNames)
  if (resolved === undefined) return entry
  return {
    ...entry,
    model: resolved.model,
    ...(entry.reasoning === undefined && resolved.reasoning !== undefined ? { reasoning: resolved.reasoning } : {}),
  }
}

function resolveFallbackModels(
  fallbackModels: OmoFallbackModels | undefined,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoFallbackModels | undefined {
  if (fallbackModels === undefined) return undefined
  if (typeof fallbackModels !== "string") {
    return fallbackModels.map((entry) => resolveModelEntry(entry, catalog, cycleNames))
  }

  const resolved = catalogReference(fallbackModels, undefined, catalog, cycleNames)
  if (resolved === undefined || resolved.reasoning === undefined) return resolved?.model ?? fallbackModels
  return [resolved]
}

function resolveAgentDefinition(
  definition: OmoAgentDef,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoAgentDef {
  const resolvedModel = definition.model === undefined
    ? undefined
    : catalogReference(definition.model, definition.reasoning, catalog, cycleNames)

  return {
    ...definition,
    ...(resolvedModel === undefined ? {} : { model: resolvedModel.model }),
    ...(definition.reasoning === undefined && resolvedModel?.reasoning !== undefined
      ? { reasoning: resolvedModel.reasoning }
      : {}),
    ...(definition.models === undefined
      ? {}
      : { models: definition.models.map((entry) => resolveModelEntry(entry, catalog, cycleNames)) }),
  }
}

function resolveCategoryDefinition(
  definition: OmoCategoryConfig,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoCategoryConfig {
  const resolvedModel = definition.model === undefined
    ? undefined
    : catalogReference(definition.model, definition.reasoning, catalog, cycleNames)

  return {
    ...definition,
    ...(resolvedModel === undefined ? {} : { model: resolvedModel.model }),
    ...(definition.reasoning === undefined && resolvedModel?.reasoning !== undefined
      ? { reasoning: resolvedModel.reasoning }
      : {}),
    ...(definition.models === undefined
      ? {}
      : { models: definition.models.map((entry) => resolveModelEntry(entry, catalog, cycleNames)) }),
    ...(definition.fallback_models === undefined
      ? {}
      : { fallback_models: resolveFallbackModels(definition.fallback_models, catalog, cycleNames) }),
  }
}

function resolveModelProfile(
  definition: OmoModelProfile,
  catalog: OmoModelCatalog | undefined,
  cycleNames: ReadonlySet<string>,
): OmoModelProfile {
  return {
    ...definition,
    ...(definition.models === undefined
      ? {}
      : { models: definition.models.map((entry) => resolveModelEntry(entry, catalog, cycleNames)) }),
  }
}

/**
 * A profile chain expands `models.<name>` references, so a profile named like a catalog entry is a
 * self-reference the cycle detector cannot see (the two live in different records).
 */
function profileShadowDiagnostics(view: OmoConfig): readonly OmoModelReferenceDiagnostic[] {
  if (view.model_profiles === undefined || view.models === undefined) return []
  return Object.keys(view.model_profiles).flatMap((name) =>
    view.models?.[name] === undefined
      ? []
      : [{
        kind: "validation" as const,
        message: `Model profile "${name}" shadows a model catalog entry of the same name`,
        path: `model_profiles.${name}`,
      }],
  )
}

/**
 * `resolveModelEntry` treats a bare chain string as a catalog reference and silently falls back to
 * the literal model id, so a profile name written into a category or agent chain resolves to a
 * nonexistent model today. Reserve that string space instead of letting it fail at runtime.
 */
function profileSpliceDiagnostics(
  section: "agents" | "categories",
  definitions: Readonly<Record<string, OmoModelChainOwner>> | undefined,
  profileNames: ReadonlySet<string>,
): readonly OmoModelReferenceDiagnostic[] {
  if (definitions === undefined || profileNames.size === 0) return []
  return Object.entries(definitions).flatMap(([name, definition]) =>
    (definition.models ?? []).flatMap((entry, index) =>
      typeof entry !== "string" || !profileNames.has(entry)
        ? []
        : [{
          kind: "validation" as const,
          message: `"${entry}" is a model profile; splicing a profile into a category chain is not supported yet`,
          path: `${section}.${name}.models.${index}`,
        }],
    ),
  )
}

function modelProfileDiagnostics(view: OmoConfig): readonly OmoModelReferenceDiagnostic[] {
  const profileNames = new Set(Object.keys(view.model_profiles ?? {}))
  return [
    ...profileShadowDiagnostics(view),
    ...profileSpliceDiagnostics("categories", view.categories, profileNames),
    ...profileSpliceDiagnostics("agents", view.agents, profileNames),
  ]
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
  const cycles = cycleDiagnostics(view.models)
  const diagnostics = [...cycles, ...modelProfileDiagnostics(view)]
  const cycleNames = new Set<string>()
  for (const diagnostic of cycles) {
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
  const modelProfiles = view.model_profiles === undefined
    ? undefined
    : Object.fromEntries(Object.entries(view.model_profiles).map(([name, definition]) => [
      name,
      resolveModelProfile(definition, view.models, cycleNames),
    ]))

  return {
    diagnostics,
    view: {
      ...view,
      ...(agents === undefined ? {} : { agents }),
      ...(categories === undefined ? {} : { categories }),
      ...(modelProfiles === undefined ? {} : { model_profiles: modelProfiles }),
    },
  }
}
