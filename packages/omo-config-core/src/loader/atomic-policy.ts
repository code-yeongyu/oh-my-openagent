import {
  OmoAtomicSettingsSchema,
  type HarnessId,
  type OmoAtomicSettings,
  type OmoHarnessId,
  type OmoLegacyHarnessId,
} from "../schema"
import { validateConfigLayer } from "./layer-validation"
import { mergeOmoConfigRecords } from "./merge"
import { harnessBlockKeys, resolveOmoConfigView } from "./resolution"
import type { OmoConfigDiagnostic, OmoConfigRawLayer } from "./types"

export type ResolvedOmoAtomicPolicy = {
  readonly settings: OmoAtomicSettings
  /** True only when a user-scoped layer enables Atomic; nothing may spawn `atomic` otherwise. */
  readonly authorized: boolean
  readonly diagnostics: readonly OmoConfigDiagnostic[]
  readonly authorization_source?: string
}

export type ResolveOmoAtomicPolicyOptions = {
  readonly layers: readonly OmoConfigRawLayer[]
  readonly harness?: OmoHarnessId | OmoLegacyHarnessId | HarnessId
  readonly profile?: string
}

const USER_ONLY_KEYS = ["enabled", "binary_path", "recording"] as const
const NARROWABLE_CONTEXT_LIMITS = ["limit", "budget_chars", "timeout_ms", "cache_ttl_ms"] as const

type Position = readonly string[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function positionsFor(options: ResolveOmoAtomicPolicyOptions): readonly Position[] {
  const blocks = harnessBlockKeys(options.harness)
  const base: Position[] = [[], ...blocks.map((block) => [block])]
  if (options.profile === undefined) return base
  const profile = ["profiles", options.profile]
  return [...base, profile, ...blocks.map((block) => [...profile, block])]
}

function valueAt(config: Readonly<Record<string, unknown>>, position: Position): unknown {
  let node: unknown = config
  for (const segment of position) {
    if (!isRecord(node)) return undefined
    node = node[segment]
  }
  return node
}

function nest(position: Position, value: Record<string, unknown>): Record<string, unknown> {
  return position.reduceRight<Record<string, unknown>>((inner, segment) => ({ [segment]: inner }), value)
}

function keyPrefix(position: Position): string {
  return position.map((segment) => `${segment}.`).join("")
}

function requalify(diagnostic: OmoConfigDiagnostic, prefix: string, path: string): OmoConfigDiagnostic {
  if (diagnostic.kind !== "unknown-keys" && diagnostic.kind !== "invalid-value") {
    return {
      kind: "invalid-value",
      message: `Ignored invalid value in ${path}: ${prefix}atomic`,
      path,
      issuePaths: [`${prefix}atomic`],
    }
  }
  const issuePaths = (diagnostic.issuePaths ?? []).map((issuePath) => `${prefix}${issuePath}`)
  const what = diagnostic.kind === "unknown-keys" ? "unknown keys" : "invalid value"
  return { ...diagnostic, message: `Ignored ${what} in ${path}: ${issuePaths.join(", ")}`, issuePaths }
}

type AtomicEntry = {
  readonly atomic: Record<string, unknown>
  readonly position: Position
}

/**
 * Every `atomic` block one layer contributes to the requested harness/profile view, each parsed with
 * the layer schema. The freeform `[opencode]` block is not validated when the file loads, so an
 * invalid or unknown value there is dropped here with a diagnostic naming its file and full key.
 */
function atomicEntries(
  layer: OmoConfigRawLayer,
  options: ResolveOmoAtomicPolicyOptions,
  diagnostics: OmoConfigDiagnostic[],
): readonly AtomicEntry[] {
  return positionsFor(options).flatMap((position) => {
    const container = valueAt(layer.config, position)
    if (!isRecord(container) || container["atomic"] === undefined) return []
    const prefix = keyPrefix(position)
    const validated = validateConfigLayer(layer.source.path, { atomic: container["atomic"] })
    diagnostics.push(...validated.diagnostics.map((diagnostic) => requalify(diagnostic, prefix, layer.source.path)))
    const atomic = validated.loaded ? validated.value["atomic"] : undefined
    return isRecord(atomic) ? [{ atomic, position }] : []
  })
}

function resolvedAtomic(
  entries: readonly AtomicEntry[],
  options: ResolveOmoAtomicPolicyOptions,
): Record<string, unknown> {
  const config = entries.reduce<Record<string, unknown>>(
    (merged, entry) => mergeOmoConfigRecords(merged, nest(entry.position, { atomic: entry.atomic })),
    {},
  )
  const view = resolveOmoConfigView({
    config,
    ...(options.harness === undefined ? {} : { harness: options.harness }),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  })
  const atomic = view.config["atomic"]
  return isRecord(atomic) ? atomic : {}
}

function unauthorizedDiagnostic(path: string, key: string): OmoConfigDiagnostic {
  return {
    kind: "unauthorized-setting",
    message: `Ignored ${key} in ${path}: only the user config may set it`,
    path,
    issuePaths: [key],
  }
}

function narrowContext(settings: OmoAtomicSettings, project: Record<string, unknown>): OmoAtomicSettings {
  const context = project["context"]
  if (!isRecord(context)) return settings
  const narrowed = { ...settings.context }
  if (context["enabled"] === false) narrowed.enabled = false
  for (const key of NARROWABLE_CONTEXT_LIMITS) {
    const value = context[key]
    if (typeof value === "number") narrowed[key] = Math.min(narrowed[key], value)
  }
  return { ...settings, context: narrowed }
}

/**
 * Resolves the Atomic settings a harness may act on. Authority comes only from user-scoped layers,
 * folded with the normal base, `[harness]`, `profiles.<P>`, `profiles.<P>.[harness]` precedence;
 * a project layer can only narrow context delivery (lower limits, disable context), and every
 * user-only key it sets is ignored with a diagnostic naming its file and key.
 */
export function resolveOmoAtomicPolicy(options: ResolveOmoAtomicPolicyOptions): ResolvedOmoAtomicPolicy {
  const diagnostics: OmoConfigDiagnostic[] = []
  const userEntries: AtomicEntry[] = []
  const projectEntries: AtomicEntry[] = []
  let authorizationSource: string | undefined

  for (const layer of options.layers) {
    const entries = atomicEntries(layer, options, diagnostics)
    if (layer.source.scope === "user") {
      userEntries.push(...entries)
      if (entries.some((entry) => entry.atomic["enabled"] !== undefined)) authorizationSource = layer.source.path
      continue
    }
    projectEntries.push(...entries)
    for (const entry of entries) {
      for (const key of USER_ONLY_KEYS) {
        if (entry.atomic[key] !== undefined) {
          diagnostics.push(unauthorizedDiagnostic(layer.source.path, `${keyPrefix(entry.position)}atomic.${key}`))
        }
      }
    }
  }

  const userSettings = OmoAtomicSettingsSchema.parse(resolvedAtomic(userEntries, options))
  const settings = narrowContext(userSettings, resolvedAtomic(projectEntries, options))
  return {
    settings,
    authorized: settings.enabled,
    diagnostics,
    ...(settings.enabled && authorizationSource !== undefined ? { authorization_source: authorizationSource } : {}),
  }
}

export function applyOmoAtomicPolicy<T extends { readonly atomic?: unknown }>(
  config: T,
  policy: ResolvedOmoAtomicPolicy,
): Omit<T, "atomic"> & { readonly atomic?: OmoAtomicSettings } {
  const { atomic: _atomic, ...rest } = config
  return policy.authorized ? { ...rest, atomic: policy.settings } : rest
}
