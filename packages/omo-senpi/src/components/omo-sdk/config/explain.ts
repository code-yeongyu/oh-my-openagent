import { loadSenpiOmoConfig } from "../../config-resolution"
import { ok, type OmoResult, refused } from "../result"
import type { ConfigContext } from "."
import { type AllowedPath, allowedPath, pathNotAllowed, segmentsOf, shapedValue } from "./allowlist"
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
    const chains = resolvedChains(global.document, project.document)
    const value = Object.hasOwn(chains, allowed.model) ? chains[allowed.model] : undefined
    // Settings scopes replace the chain map wholesale, so only the scope whose map won can be the source.
    const winner = valueAt(project.document, ["retry", "fallbackChains"]) === undefined ? "global" : "project"
    const fromWinner = winner === "project" ? fromProject : fromGlobal
    const defaultChain = Object.hasOwn(ENGINE_DEFAULT_FALLBACK_CHAINS, allowed.model)
      ? ENGINE_DEFAULT_FALLBACK_CHAINS[allowed.model]
      : undefined
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
