import { describeModelChains } from "@oh-my-opencode/senpi-task/model-chains"
import { refused, type OmoResult } from "../result"
import { ENGINE_DEFAULTS, type EngineDefaultKey, isEngineSettingValue, isRecord } from "./engine"

/**
 * The security ruling's one exception: the keys whose path, value and scope an SDK caller may read. Everything else in
 * a config file (providers, URLs, headers, env, credentials, free-form text, unknown keys) never leaves the SDK.
 */
const ROUTING_KEYS = ["model", "models", "fallback_models", "variant", "reasoning"] as const
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

const TOKEN = /^[a-z0-9][a-z0-9_-]{0,31}$/
const MODEL_ID = /^(?:[A-Za-z0-9._:-]+\/)?[A-Za-z0-9._:-]+$/
const CREDENTIAL_PREFIX = /^(?:sk-|pk-|rk-|ghp_|gho_|ghs_|github_pat_|glpat-|hf_|gsk_|xai-|xox[abpr]-|AKIA|AIza)/i
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/

// A model id is read as words, numbers and version tags between separators. Every part must have one of the shapes
// below, so a random credential (a UUID, a hex group, an opaque run, a secret key) cannot pass by luck.
const PART_SEPARATOR = /[-._:]/
const MODEL_PARTS = [
  /^[a-z]{1,12}$/, // gpt, claude, sonnet, instruct
  /^[A-Z][a-z]{1,10}(?:[A-Z][a-z]{1,10})?$/, // Llama, Instruct, DeepSeek
  /^[A-Z]{1,4}$/, // V, VL, AWQ, GGUF
  /^[0-9]{1,8}$/, // 5, 0309, 20241022
  /^[0-9]{1,4}[A-Za-z]$/, // 4o, 70B, 235b
  /^(?:[a-z]{1,8}|[A-Z][a-z]{0,7}|[A-Z]{1,4})[0-9]{1,4}[bB]?$/, // qwen3, Qwen3, k3, v1, q4, A22B, system24
  /^[0-9]{1,3}x[0-9]{1,3}[A-Za-z]?$/, // 8x7B
] as const
// A family name: a model part that starts with a word of two letters or more (claude, Llama, qwen3, DeepSeek).
const FAMILY_WORD = /^(?:[a-z]{2}|[A-Z][a-z])/
const MAX_PARTS = 12

export const EMPTY_REGISTRY = { getAvailable: () => [], find: () => undefined }

let builtins: { readonly categories: ReadonlySet<string>; readonly agents: ReadonlySet<string> } | undefined

/**
 * The builtin category and task-agent names: the only names the SDK lists in status routing or answers for in explain
 * and check. A name a config file defines is a key name from that file, so it stays out even when it is a slug.
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

/** One side of a model id (the provider or the model): only model-shaped parts, and at least one word. */
function isModelSide(side: string): boolean {
  if (CREDENTIAL_PREFIX.test(side)) return false
  const parts = side.split(PART_SEPARATOR)
  return (
    parts.length <= MAX_PARTS &&
    parts.every((part) => MODEL_PARTS.some((shape) => shape.test(part))) &&
    parts.some((part) => FAMILY_WORD.test(part))
  )
}

/** A model id that cannot be mistaken for a credential: an optional provider, then a model, both built of model parts. */
export const isModelId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 120 && MODEL_ID.test(value) && value.split("/").every(isModelSide)

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
  const [root, name, key] = segments as readonly unknown[]
  if (root !== "categories" && root !== "agents") return undefined
  // Builtin names only: answering for a name a config file defines would confirm a guessed key of that file.
  if (typeof name !== "string" || !builtinNames()[root].has(name)) return undefined
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
