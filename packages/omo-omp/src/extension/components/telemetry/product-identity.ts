import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import {
  DEFAULT_POSTHOG_HOST,
  type TelemetryEnv,
  type TelemetryProductConfig,
} from "@oh-my-opencode/telemetry-core"
import { BUILTIN_CATEGORY_DEFAULTS, CURATED_READONLY_AGENT_NAMES } from "@oh-my-opencode/senpi-task"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"

export const OMO_NATIVE_POSTHOG_API_KEY = "phc_REPLACE_ME_OMO_NATIVE"

export type OmoNativePropertyType = "boolean" | "number" | "string"

export type OmoNativePropertySchema = {
  readonly type: OmoNativePropertyType
  readonly values?: readonly string[]
}

const BOOLEAN_PROPERTY = Object.freeze({ type: "boolean" } as const)
const NUMBER_PROPERTY = Object.freeze({ type: "number" } as const)
const STRING_PROPERTY = Object.freeze({ type: "string" } as const)

function enumProperty<const Values extends readonly string[]>(values: Values): Readonly<{
  type: "string"
  values: Values
}> {
  return Object.freeze({ type: "string", values: Object.freeze(values) })
}

export const KNOWN_MODELS = Object.freeze({
  anthropic: Object.freeze(["claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"]),
  "anthropic-api": Object.freeze(["claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5"]),
  deepseek: Object.freeze(["deepseek-v4-flash", "deepseek-v4-pro"]),
  google: Object.freeze(["gemini-3.6-flash"]),
  "github-copilot": Object.freeze([
    "claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5", "gpt-5.6-sol",
    "gpt-5.6-terra",
  ]),
  "kimi-for-coding": Object.freeze(["k3", "kimi-for-coding-highspeed", "kimi-k3"]),
  moonshotai: Object.freeze(["kimi-k3"]),
  openai: Object.freeze(["gpt-5.6-luna-fast", "gpt-5.6-sol", "gpt-5.6-terra"]),
  opencode: Object.freeze(["claude-opus-5", "claude-sonnet-5", "gpt-5.6-sol", "kimi-k3"]),
  "opencode-go": Object.freeze(["deepseek-v4-pro", "kimi-k3", "minimax-m2.7", "minimax-m3"]),
  "quotio-openai": Object.freeze(["gpt-5.6-luna-fast", "gpt-5.6-sol", "gpt-5.6-terra"]),
  vercel: Object.freeze([
    "claude-fable-5", "claude-haiku-4-5", "claude-opus-5", "claude-sonnet-5", "deepseek-v4-flash",
    "deepseek-v4-pro", "gemini-3.6-flash", "gpt-5.6-sol", "gpt-5.6-terra", "kimi-k3", "minimax-m2.7",
    "minimax-m3",
  ]),
  xai: Object.freeze(["grok-4.20-0309-non-reasoning"]),
} as const)

export type KnownProvider = keyof typeof KNOWN_MODELS
export const KNOWN_PROVIDERS = Object.freeze(Object.keys(KNOWN_MODELS) as KnownProvider[])
export const CURATED_AGENTS = Object.freeze([...CURATED_READONLY_AGENT_NAMES])
export const BUILTIN_CATEGORY_NAMES = Object.freeze(BUILTIN_CATEGORY_DEFAULTS.map(({ name }) => name))
export const BUILTIN_SKILL_NAMES = Object.freeze([
  "ast-grep", "coding-agent-sessions", "data-scientist", "debugging", "frontend", "git-master",
  "give-me-tips", "hyperplan", "init-deep", "lsp-setup", "programming", "refactor", "remove-ai-slops",
  "review-work", "start-work", "ultimate-browsing", "ultrawork", "ulw-loop", "ulw-plan", "ulw-research",
  "visual-qa",
] as const)

export const OMO_NATIVE_EVENT_SCHEMAS = Object.freeze({
  daily_active: Object.freeze({
    "$session_id": STRING_PROPERTY,
    day_utc: STRING_PROPERTY,
    reason: enumProperty(["session_start"] as const),
  }),
  session_started: Object.freeze({
    "$session_id": STRING_PROPERTY,
    "$os": STRING_PROPERTY,
    "$os_version": STRING_PROPERTY,
    arch: STRING_PROPERTY,
    cpu_count: NUMBER_PROPERTY,
    default_model: enumProperty([...new Set(Object.values(KNOWN_MODELS).flat()), "custom"] as const),
    default_provider: enumProperty([...KNOWN_PROVIDERS, "custom"] as const),
    memory_bucket: enumProperty(["lt_8_gb", "8_15_gb", "16_31_gb", "32_63_gb", "64_plus_gb"] as const),
    model_count: NUMBER_PROPERTY,
    provider_count: NUMBER_PROPERTY,
    providers: STRING_PROPERTY,
    reason: enumProperty(["startup", "reload", "new", "resume", "fork"] as const),
  }),
  prompt_submitted: Object.freeze({
    "$session_id": STRING_PROPERTY,
    input_source: enumProperty(["interactive", "rpc", "extension"] as const),
    invocation_stage: enumProperty(["none", "first_arm", "remention", "post_compact_rearm"] as const),
    is_effective_ultrawork_invocation: BOOLEAN_PROPERTY,
    is_real_user_prompt: BOOLEAN_PROPERTY,
    is_turn_start: BOOLEAN_PROPERTY,
    keyword_any: BOOLEAN_PROPERTY,
    keyword_occurrence_bucket: enumProperty(["1", "2", "3_5", "6_plus"] as const),
    keyword_ultrawork_full: BOOLEAN_PROPERTY,
    keyword_ulw_abbrev: BOOLEAN_PROPERTY,
    keyword_variant: enumProperty(["none", "ulw", "ultrawork", "both"] as const),
    prompt_length_bucket: enumProperty(["lt_100", "100_500", "500_2000", "gte_2000"] as const),
    queue_mode: enumProperty(["immediate", "follow_up", "steer", "other"] as const),
    real_prompt_ordinal_bucket: enumProperty(["1", "2_3", "4_10", "11_25", "26_plus"] as const),
    suppression_reason: enumProperty([
      "none", "no_keyword", "extension_source", "embedded_directive", "skill_expansion", "skill_name_only",
    ] as const),
  }),
  turn_completed: Object.freeze({
    "$session_id": STRING_PROPERTY,
    cache_read_tokens: NUMBER_PROPERTY,
    cache_write_tokens: NUMBER_PROPERTY,
    cost_usd: NUMBER_PROPERTY,
    input_tokens: NUMBER_PROPERTY,
    model_id: enumProperty([...new Set(Object.values(KNOWN_MODELS).flat()), "custom"] as const),
    output_tokens: NUMBER_PROPERTY,
    provider: enumProperty([...KNOWN_PROVIDERS, "custom"] as const),
    reasoning_tokens: NUMBER_PROPERTY,
    total_tokens: NUMBER_PROPERTY,
    turn_index: NUMBER_PROPERTY,
  }),
  skill_loaded: Object.freeze({
    "$session_id": STRING_PROPERTY,
    skill_name: enumProperty(BUILTIN_SKILL_NAMES),
  }),
  delegation_started: Object.freeze({
    "$session_id": STRING_PROPERTY,
    background: BOOLEAN_PROPERTY,
    batch_size_bucket: enumProperty(["1", "2_4", "5_plus"] as const),
    kind: enumProperty(["category", "subagent"] as const),
    name: enumProperty([...BUILTIN_CATEGORY_NAMES, ...CURATED_AGENTS, "custom"] as const),
  }),
  feature_used: Object.freeze({
    "$session_id": STRING_PROPERTY,
    feature: enumProperty(["goal_tool", "team_create", "memory_tool"] as const),
  }),
} as const)

export const OMO_NATIVE_PROPERTY_ALLOWLISTS = Object.freeze(Object.fromEntries(
  Object.entries(OMO_NATIVE_EVENT_SCHEMAS).map(([eventName, properties]) => [
    eventName,
    Object.freeze(Object.keys(properties)),
  ]),
) as { readonly [EventName in keyof typeof OMO_NATIVE_EVENT_SCHEMAS]: readonly (keyof typeof OMO_NATIVE_EVENT_SCHEMAS[EventName] & string)[] })

export type OmoNativeEventName = keyof typeof OMO_NATIVE_EVENT_SCHEMAS

declare const OMO_SENPI_PACKAGE_VERSION: string

const PACKAGE_VERSION = typeof OMO_SENPI_PACKAGE_VERSION === "string"
  ? OMO_SENPI_PACKAGE_VERSION
  : readPackageVersion()
const SALT_FILE_NAME = "session-id-salt"
const SALT_LENGTH = 32
const fallbackSalts = new Map<string, Buffer>()

export function createOmoNativeProductConfig(): TelemetryProductConfig & { readonly disableGeoip: true } {
  return {
    cacheDirName: "omo-native",
    defaultApiKey: OMO_NATIVE_POSTHOG_API_KEY,
    defaultHost: DEFAULT_POSTHOG_HOST,
    disableGeoip: true,
    eventName: "daily_active",
    machineIdPrefix: "omo-senpi:",
    packageName: "@oh-my-opencode/omo-senpi",
    packageVersion: PACKAGE_VERSION,
    platform: "omo-senpi",
    productEnvPrefix: "OMO_SENPI",
    productName: "omo-native",
  }
}

export function getOmoNativeStateDir(env: TelemetryEnv = process.env): string {
  return join(resolveAgentHome({ env }), "omo-senpi", "omo-native")
}

export function getBuiltinSkillsRoot(): string {
  return fileURLToPath(new URL("../skills/", import.meta.url))
}

export function hashSessionId(rawId: string): string {
  const salt = readOrCreateSalt(join(getOmoNativeStateDir(), SALT_FILE_NAME))
  return createHash("sha256").update(salt).update(rawId).digest("hex")
}

export function maskProviderAndModel(provider: string, modelId: string): { provider: string; model_id: string } {
  const knownProvider = isKnownProvider(provider)
  const knownModels: readonly string[] | undefined = knownProvider ? KNOWN_MODELS[provider] : undefined
  return {
    provider: knownProvider ? provider : "custom",
    model_id: knownModels?.includes(modelId) === true ? modelId : "custom",
  }
}

function isKnownProvider(provider: string): provider is KnownProvider {
  return Object.hasOwn(KNOWN_MODELS, provider)
}

function readOrCreateSalt(path: string): Buffer {
  const persisted = readSalt(path)
  if (persisted !== undefined) return persisted

  const salt = randomBytes(SALT_LENGTH)
  try {
    mkdirSync(getOmoNativeStateDir(), { recursive: true })
    writeFileSync(path, salt, { flag: "wx", mode: 0o600 })
    fallbackSalts.delete(path)
    return salt
  } catch {
    const concurrentlyCreated = readSalt(path)
    if (concurrentlyCreated !== undefined) return concurrentlyCreated
    try {
      writeFileSync(path, salt, { flag: "w", mode: 0o600 })
      fallbackSalts.delete(path)
      return salt
    } catch {
      const fallback = fallbackSalts.get(path)
      if (fallback !== undefined) return fallback
      fallbackSalts.set(path, salt)
      return salt
    }
  }
}

function readSalt(path: string): Buffer | undefined {
  try {
    const salt = readFileSync(path)
    return salt.length === SALT_LENGTH ? salt : undefined
  } catch {
    // Missing or unreadable salt is repaired by the caller. Telemetry identity must never block the host.
    return undefined
  }
}

function readPackageVersion(): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"))
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const version = Reflect.get(parsed, "version")
      if (typeof version === "string") return version
    }
  } catch {
    return "0.0.0"
  }
  return "0.0.0"
}
