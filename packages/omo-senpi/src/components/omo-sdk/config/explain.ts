import { loadSenpiOmoConfig } from "../../config-resolution"
import { ok, type OmoResult, refused } from "../result"
import type { ConfigContext } from "."
import {
  type AllowedPath,
  allowedPath,
  builtinNames,
  pathNotAllowed,
  ROUTING_KEYS,
  segmentsOf,
  shapedValue,
} from "./allowlist"
import { ENGINE_DEFAULT_FALLBACK_CHAINS } from "./engine-fallback-chains"
import { ENGINE_DEFAULTS, readEngineLayers, resolvedChains, valueAt } from "./engine"

export type ConfigScope = "user" | "project" | "global"

/** A value as the SDK shows it: unset, the value, or `value_withheld` when it lacks the shape its key promises. */
export type ExplainedValue =
  | { readonly set: false }
  | { readonly set: true; readonly value: unknown }
  | { readonly set: true; readonly value_withheld: true }

export type ExplainedLayer = ExplainedValue & { readonly scope: ConfigScope }

export type ConfigExplanation = ExplainedValue & {
  readonly path: string
  readonly source: ConfigScope | "default" | "unset"
  /** The engine's default for an `engine:` key, when it has one. */
  readonly default?: unknown
  /** Each existing file's value for the key by scope, lowest precedence first. */
  readonly layers: readonly ExplainedLayer[]
}

const NEAREST_COUNT = 3

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (left[i - 1] === right[j - 1] ? 0 : 1)
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution))
    }
    previous = current
  }
  return previous[right.length] ?? 0
}

/** A refusal whose nearest paths are allowlisted keys of names the SDK may show; the asked path is not echoed. */
function unknownPath<T>(path: string, candidates: readonly string[]): OmoResult<T> {
  const nearest = [...new Set(candidates)]
    .map((candidate) => ({ candidate, distance: editDistance(path, candidate) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
    .slice(0, NEAREST_COUNT)
    .map((entry) => entry.candidate)
  return refused("unknown_path", "no category or agent has that name", "explain one of the nearest paths", { nearest })
}

function shown(allowed: AllowedPath, value: unknown): ExplainedValue {
  if (value === undefined) return { set: false }
  const shaped = shapedValue(allowed, value)
  return shaped === undefined ? { set: true, value_withheld: true } : { set: true, value: shaped.value }
}

function explainEngine(context: ConfigContext, allowed: Exclude<AllowedPath, { kind: "routing" }>): ConfigExplanation {
  const segments = segmentsOf(allowed)
  const { global, project } = readEngineLayers(context)
  const layers = [global, project]
    .filter((file) => file.exists)
    .map((file) => ({ scope: file.scope, ...shown(allowed, valueAt(file.document, segments)) }))
  const fromProject = valueAt(project.document, segments)
  const fromGlobal = valueAt(global.document, segments)
  if (allowed.kind === "engine-chain") {
    const value = resolvedChains(global.document, project.document)[allowed.model]
    // Settings scopes replace the chain map wholesale, so only the scope whose map won can be the source.
    const winner = valueAt(project.document, ["retry", "fallbackChains"]) === undefined ? "global" : "project"
    const fromWinner = winner === "project" ? fromProject : fromGlobal
    const defaultChain = ENGINE_DEFAULT_FALLBACK_CHAINS[allowed.model]
    return {
      path: allowed.path,
      ...shown(allowed, value),
      source: fromWinner !== undefined ? winner : value !== undefined ? "default" : "unset",
      ...(defaultChain === undefined ? {} : { default: defaultChain }),
      layers,
    }
  }
  const defaultValue = ENGINE_DEFAULTS[allowed.key]
  return {
    path: allowed.path,
    ...shown(allowed, fromProject ?? fromGlobal ?? defaultValue),
    source: fromProject !== undefined ? "project" : fromGlobal !== undefined ? "global" : "default",
    default: defaultValue,
    layers,
  }
}

function explainRouting(
  context: ConfigContext,
  allowed: Extract<AllowedPath, { kind: "routing" }>,
): OmoResult<ConfigExplanation> {
  const segments = segmentsOf(allowed)
  const loaded = loadSenpiOmoConfig({ cwd: context.cwd, env: context.env })
  const builtin = builtinNames()
  const configured = [loaded.config, ...loaded.layers.map((layer) => layer.config)].some(
    (config) => valueAt(config, [allowed.root, allowed.name]) !== undefined,
  )
  if (!configured && !builtin[allowed.root].has(allowed.name))
    return unknownPath(
      allowed.path,
      (["categories", "agents"] as const).flatMap((root) =>
        [...builtin[root]].flatMap((name) => ROUTING_KEYS.map((key) => `${root}.${name}.${key}`)),
      ),
    )

  const rawValues = loaded.layers.map((layer) => ({ layer, value: valueAt(layer.config, segments) }))
  const winner = rawValues.findLast((entry) => entry.value !== undefined)
  const value = winner?.value ?? valueAt(loaded.config, segments)
  const layers = loaded.sources
    .filter((source) => source.exists)
    .map((source) => ({
      scope: source.scope,
      ...shown(allowed, rawValues.find((entry) => entry.layer.source.path === source.path)?.value),
    }))
  return ok({
    path: allowed.path,
    ...shown(allowed, value),
    source: winner !== undefined ? winner.layer.source.scope : value !== undefined ? "default" : "unset",
    layers,
  })
}

export function explainConfig(context: ConfigContext, path: unknown): OmoResult<ConfigExplanation> {
  const allowed = allowedPath(path)
  if (allowed === undefined) return pathNotAllowed()
  return allowed.kind === "routing" ? explainRouting(context, allowed) : ok(explainEngine(context, allowed))
}
