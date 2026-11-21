import { OmoCategoryConfigObjectSchema } from "@oh-my-opencode/omo-config-core"
import { describeModelChains } from "@oh-my-opencode/senpi-task/model-chains"
import { loadSenpiOmoConfig } from "../../config-resolution"
import { ok, type OmoResult, refused } from "../result"
import type { ConfigContext } from "."
import { ENGINE_DEFAULT_FALLBACK_CHAINS } from "./engine-fallback-chains"
import {
  ENGINE_DEFAULTS,
  type EngineDefaultKey,
  engineKeySegments,
  engineView,
  readEngineLayers,
  valueAt,
} from "./engine"
import { ROUTING_KEYS } from "./policy-rules"

export const ENGINE_PATH_PREFIX = "engine:"

export type LayerValue = {
  readonly scope: "user" | "project" | "global"
  readonly file: string
  readonly set: boolean
  readonly value?: unknown
}

export type ConfigExplanation = {
  readonly path: string
  readonly set: boolean
  readonly value?: unknown
  readonly source: "user" | "project" | "global" | "default" | "unset"
  /** The engine's default for an `engine:` key, when it has one. */
  readonly default?: unknown
  /** Each existing file's value for the key, lowest precedence first. */
  readonly layers: readonly LayerValue[]
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

const nearest = (path: string, candidates: Iterable<string>): readonly string[] =>
  [...new Set(candidates)]
    .map((candidate) => ({ candidate, distance: editDistance(path, candidate) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
    .slice(0, NEAREST_COUNT)
    .map((entry) => entry.candidate)

const unknownPath = <T>(path: string, candidates: Iterable<string>): OmoResult<T> =>
  refused("unknown_path", `no configuration key is named ${path}`, "explain one of the nearest valid paths", {
    nearest: nearest(path, candidates),
  })

const layerValue = (scope: LayerValue["scope"], file: string, value: unknown): LayerValue =>
  value === undefined ? { scope, file, set: false } : { scope, file, set: true, value }

function explainEngine(context: ConfigContext, path: string): OmoResult<ConfigExplanation> {
  const key = path.slice(ENGINE_PATH_PREFIX.length)
  const segments = engineKeySegments(key)
  const isChain = segments.length === 3 && segments[0] === "retry" && segments[1] === "fallbackChains"
  if (!isChain && !Object.hasOwn(ENGINE_DEFAULTS, key))
    return unknownPath(
      path,
      [...Object.keys(ENGINE_DEFAULTS), "retry.fallbackChains.<model>"].map((k) => `${ENGINE_PATH_PREFIX}${k}`),
    )

  const { global, project } = readEngineLayers(context)
  const layers = [global, project]
    .filter((file) => file.exists)
    .map((file) => layerValue(file.scope, file.path, valueAt(file.document, segments)))
  const fromProject = valueAt(project.document, segments)
  const fromGlobal = valueAt(global.document, segments)
  if (isChain) {
    const model = segments[2] ?? ""
    const value = engineView(global.document, project.document).fallbackChains[model]
    // Settings scopes replace the chain map wholesale, so only the scope whose map won can be the source.
    const winner = valueAt(project.document, ["retry", "fallbackChains"]) === undefined ? "global" : "project"
    const fromWinner = winner === "project" ? fromProject : fromGlobal
    const defaultChain = ENGINE_DEFAULT_FALLBACK_CHAINS[model]
    const source = fromWinner !== undefined ? winner : value !== undefined ? "default" : "unset"
    return ok({
      path,
      set: value !== undefined,
      ...(value === undefined ? {} : { value }),
      source,
      ...(defaultChain === undefined ? {} : { default: defaultChain }),
      layers,
    })
  }
  const defaultValue = ENGINE_DEFAULTS[key as EngineDefaultKey]
  const source = fromProject !== undefined ? "project" : fromGlobal !== undefined ? "global" : "default"
  return ok({
    path,
    set: true,
    value: fromProject ?? fromGlobal ?? defaultValue,
    source,
    default: defaultValue,
    layers,
  })
}

function explainOmo(context: ConfigContext, path: string): OmoResult<ConfigExplanation> {
  const segments = path.split(".")
  const loaded = loadSenpiOmoConfig({ cwd: context.cwd, env: context.env })
  const rawValues = loaded.layers.map((layer) => ({ layer, value: valueAt(layer.config, segments) }))
  const resolved = valueAt(loaded.config, segments)

  // The routing report lists every builtin and configured category and every task agent.
  const routing = describeModelChains(loaded.config, { getAvailable: () => [], find: () => undefined })
  const categoryNames = new Set(routing.categories.map((entry) => entry.name))
  const agentNames = new Set(routing.agents.map((entry) => entry.name))
  const categoryKeys = Object.keys(OmoCategoryConfigObjectSchema.shape)
  const entryPath = (root: string, names: Iterable<string>, keys: readonly string[]) =>
    [...names].flatMap((name) => keys.map((key) => `${root}.${name}.${key}`))
  const [root, name, key] = segments
  const knownEntryKey =
    segments.length === 3 &&
    ((root === "categories" && categoryNames.has(name ?? "") && categoryKeys.includes(key ?? "")) ||
      (root === "agents" && agentNames.has(name ?? "") && (ROUTING_KEYS as readonly string[]).includes(key ?? "")))
  const present = resolved !== undefined || rawValues.some((entry) => entry.value !== undefined)
  if (!knownEntryKey && !present)
    return unknownPath(path, [
      ...entryPath("categories", categoryNames, ROUTING_KEYS),
      ...entryPath("agents", agentNames, ROUTING_KEYS),
    ])

  const winner = rawValues.findLast((entry) => entry.value !== undefined)
  const value = winner?.value ?? resolved
  const sourceOf = loaded.sources.filter((source) => source.exists)
  const layers = sourceOf.map((source) =>
    layerValue(source.scope, source.path, rawValues.find((entry) => entry.layer.source.path === source.path)?.value),
  )
  return ok({
    path,
    set: value !== undefined,
    ...(value === undefined ? {} : { value }),
    source: winner !== undefined ? winner.layer.source.scope : value !== undefined ? "default" : "unset",
    layers,
  })
}

export function explainConfig(context: ConfigContext, path: string): OmoResult<ConfigExplanation> {
  return path.startsWith(ENGINE_PATH_PREFIX) ? explainEngine(context, path) : explainOmo(context, path)
}
