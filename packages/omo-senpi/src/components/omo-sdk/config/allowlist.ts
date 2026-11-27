import { describeModelChains } from "@oh-my-opencode/senpi-task/model-chains"
import { refused, type OmoResult } from "../result"
import { ENGINE_DEFAULTS, type EngineDefaultKey, isEngineSettingValue, isRecord } from "./engine"

/**
 * The security ruling's one exception: the keys whose path, value and scope an SDK caller may read. Everything else in
 * a config file (providers, URLs, headers, env, credentials, free-form text, unknown keys) never leaves the SDK.
 */
export const ROUTING_KEYS = ["model", "models", "fallback_models", "variant", "reasoning"] as const
export type RoutingKey = (typeof ROUTING_KEYS)[number]
const ENGINE_PATH_PREFIX = "engine:"
const CHAINS_KEY = "retry.fallbackChains."

export type AllowedPath =
  | {
      readonly kind: "routing"
      readonly root: "categories" | "agents"
      readonly name: string
      readonly key: RoutingKey
      readonly path: string
    }
  | { readonly kind: "engine-setting"; readonly key: EngineDefaultKey; readonly path: string }
  | { readonly kind: "engine-chain"; readonly model: string; readonly path: string }

const ALLOWED_PATHS: readonly string[] = [
  ...ROUTING_KEYS.map((key) => `categories.<name>.${key}`),
  ...ROUTING_KEYS.map((key) => `agents.<name>.${key}`),
  ...Object.keys(ENGINE_DEFAULTS).map((key) => `${ENGINE_PATH_PREFIX}${key}`),
  `${ENGINE_PATH_PREFIX}${CHAINS_KEY}<model>`,
]

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/
const PROTOTYPE_NAMES: ReadonlySet<string> = new Set(["constructor", "prototype"])
const TOKEN = /^[a-z0-9][a-z0-9_-]{0,31}$/
const MODEL_ID = /^(?:[A-Za-z0-9._:-]+\/)?[A-Za-z0-9._:-]+$/
const CREDENTIAL_PREFIX = /^(?:sk-|pk-|rk-|ghp_|gho_|ghs_|xox[abpr]-|AKIA|AIza)/i
const CREDENTIAL_RUN = /[A-Za-z0-9_]{24,}/
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/

/** A category or agent name a caller may pass: every builtin name, or a short lowercase slug. */
const isName = (name: string): boolean => NAME.test(name) && !PROTOTYPE_NAMES.has(name)

export const EMPTY_REGISTRY = { getAvailable: () => [], find: () => undefined }

let builtins: { readonly categories: ReadonlySet<string>; readonly agents: ReadonlySet<string> } | undefined

/**
 * The builtin category and task-agent names: the only names the SDK lists unasked (status routing, an unknown_path's
 * nearest paths). A name a config file defines is a key name from that file, so it stays out even when it is a slug.
 */
export function builtinNames(): { readonly categories: ReadonlySet<string>; readonly agents: ReadonlySet<string> } {
  if (builtins !== undefined) return builtins
  const report = describeModelChains({}, EMPTY_REGISTRY)
  builtins = {
    categories: new Set(report.categories.map((entry) => entry.name)),
    agents: new Set(report.agents.map((entry) => entry.name)),
  }
  return builtins
}

/** A model id that cannot be mistaken for a credential: provider prefix optional, no key prefix, no long opaque run. */
export const isModelId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 120 &&
  MODEL_ID.test(value) &&
  !CREDENTIAL_RUN.test(value) &&
  value.split("/").every((part) => !CREDENTIAL_PREFIX.test(part))

const isToken = (value: unknown): value is string => typeof value === "string" && TOKEN.test(value)

export const shownModel = (model: string): string => (isModelId(model) ? model : "a model id the SDK withholds")

export const shownVersion = (version: string | undefined): string | undefined =>
  version !== undefined && VERSION.test(version) ? version : undefined

export function allowedPath(path: unknown): AllowedPath | undefined {
  if (typeof path === "string" && path.startsWith(ENGINE_PATH_PREFIX)) {
    const key = path.slice(ENGINE_PATH_PREFIX.length)
    if (Object.hasOwn(ENGINE_DEFAULTS, key)) return { kind: "engine-setting", key: key as EngineDefaultKey, path }
    const model = key.startsWith(CHAINS_KEY) ? key.slice(CHAINS_KEY.length) : undefined
    return model !== undefined && isModelId(model) ? { kind: "engine-chain", model, path } : undefined
  }
  const segments: unknown = typeof path === "string" ? path.split(".") : path
  if (!Array.isArray(segments) || segments.length !== 3) return undefined
  const [root, name, key] = segments
  if (root !== "categories" && root !== "agents") return undefined
  if (typeof name !== "string" || !isName(name)) return undefined
  const routingKey = ROUTING_KEYS.find((candidate) => candidate === key)
  return routingKey === undefined
    ? undefined
    : { kind: "routing", root, name, key: routingKey, path: `${root}.${name}.${routingKey}` }
}

export const segmentsOf = (allowed: AllowedPath): readonly string[] =>
  allowed.kind === "routing"
    ? [allowed.root, allowed.name, allowed.key]
    : allowed.kind === "engine-setting"
      ? allowed.key.split(".")
      : ["retry", "fallbackChains", allowed.model]

/** A `models` / `fallback_models` entry: a model id, or an object reduced to its gated model, variant and reasoning. */
function shapedModelEntry(entry: unknown): { readonly value: unknown } | undefined {
  if (isModelId(entry)) return { value: entry }
  if (!isRecord(entry) || !isModelId(entry["model"])) return undefined
  const shaped: Record<string, string> = { model: entry["model"] }
  for (const field of ["variant", "reasoning"] as const) {
    const value = entry[field]
    if (value === undefined) continue
    if (!isToken(value)) return undefined
    shaped[field] = value
  }
  return { value: shaped }
}

function shapedModelList(value: unknown): { readonly value: unknown } | undefined {
  if (!Array.isArray(value)) return shapedModelEntry(value)
  const entries = value.map(shapedModelEntry)
  return entries.every((entry) => entry !== undefined) ? { value: entries.map((entry) => entry.value) } : undefined
}

/** The value as a caller may see it, or undefined when it does not have the shape its key promises. */
export function shapedValue(allowed: AllowedPath, value: unknown): { readonly value: unknown } | undefined {
  switch (allowed.kind) {
    case "engine-setting":
      return isEngineSettingValue(allowed.key, value) ? { value } : undefined
    case "engine-chain":
      return Array.isArray(value) && value.every(isModelId) ? { value } : undefined
    case "routing":
      if (allowed.key === "model") return isModelId(value) ? { value } : undefined
      if (allowed.key === "variant" || allowed.key === "reasoning") return isToken(value) ? { value } : undefined
      return shapedModelList(value)
  }
}

export const pathNotAllowed = <T>(): OmoResult<T> =>
  refused(
    "path_not_allowed",
    "the SDK does not report or check that configuration key",
    "use a model-routing key or a typed engine setting",
    { allowed: ALLOWED_PATHS },
  )
