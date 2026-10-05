import { CURATED_READONLY_AGENT_NAMES } from "@oh-my-opencode/senpi-task/agents-builtin"
import { BUILTIN_CATEGORY_DEFAULTS } from "@oh-my-opencode/senpi-task/category-builtins"
import { ERROR_CODES } from "@oh-my-opencode/senpi-desktop-protocol"
import { CATEGORY_CONFIG_SCHEMA } from "./category-config-schema"
import { PROCESS_CRASHED_SCHEMA } from "./crash-schema"
import { buildDelegationCompletedSchema } from "./delegation-schema"
import { KIBITZER_SUMMARY_SCHEMA } from "./kibitzer-schema"
import { KNOWN_MODELS, KNOWN_PROVIDERS } from "./model-vocabulary"
import { PARALLELISM_SUMMARY_SCHEMA } from "./parallelism-schema"

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

export const CURATED_AGENTS = Object.freeze([...CURATED_READONLY_AGENT_NAMES])
export const BUILTIN_CATEGORY_NAMES = Object.freeze(BUILTIN_CATEGORY_DEFAULTS.map(({ name }) => name))
export const BUILTIN_SKILL_NAMES = Object.freeze([
  "ast-grep", "browser", "coding-agent-sessions", "dag-library", "data-scientist", "debugging", "frontend", "git-master",
  "give-me-tips", "hyperplan", "init-deep", "lsp-setup", "mass-ulw", "onboarding", "programming", "refactor",
  "remove-ai-slops",
  "review-work", "ulw-execute", "ultimate-browsing", "ultrawork", "ulw-loop", "ulw-plan", "ulw-research",
  "visual-qa",
] as const)
export const COMPUTER_USE_ACTIVATION_SOURCES = Object.freeze([
  "tool_call", "command_on", "command_off", "other",
] as const)
export const COMPUTER_USE_BACKENDS = Object.freeze([
  "quartz", "x11", "wayland", "win32", "fake", "unavailable", "other",
] as const)
export const COMPUTER_USE_ENGINE_ERROR_CODES = Object.freeze([
  ...ERROR_CODES,
  "native-unavailable",
  "quarantined",
  "abi-mismatch",
  "other",
] as const)
export const COMPUTER_USE_PERMISSIONS = Object.freeze([
  "capture", "input", "ax", "read", "exec",
] as const)
export const COMPUTER_USE_PERMISSION_SCOPES = Object.freeze(["os", "tier"] as const)
export const COMPUTER_USE_PLATFORMS = Object.freeze(["darwin", "linux", "win32", "other"] as const)

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
    // Device-reported IANA zone. A timezone signal, never a country signal: countries share zones,
    // span zones, and users override them. Country comes from PostHog's server-side GeoIP.
    timezone: STRING_PROPERTY,
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
  computer_use_activation: Object.freeze({
    "$session_id": STRING_PROPERTY,
    active: BOOLEAN_PROPERTY,
    backend: enumProperty(COMPUTER_USE_BACKENDS),
    host_platform: enumProperty(COMPUTER_USE_PLATFORMS),
    source: enumProperty(COMPUTER_USE_ACTIVATION_SOURCES),
  }),
  computer_use_permission_denied: Object.freeze({
    "$session_id": STRING_PROPERTY,
    backend: enumProperty(COMPUTER_USE_BACKENDS),
    host_platform: enumProperty(COMPUTER_USE_PLATFORMS),
    permission: enumProperty(COMPUTER_USE_PERMISSIONS),
    scope: enumProperty(COMPUTER_USE_PERMISSION_SCOPES),
  }),
  computer_use_engine_error: Object.freeze({
    "$session_id": STRING_PROPERTY,
    backend: enumProperty(COMPUTER_USE_BACKENDS),
    code: enumProperty(COMPUTER_USE_ENGINE_ERROR_CODES),
    host_platform: enumProperty(COMPUTER_USE_PLATFORMS),
  }),
  kibitzer_summary: KIBITZER_SUMMARY_SCHEMA,
  parallelism_summary: PARALLELISM_SUMMARY_SCHEMA,
  delegation_completed: buildDelegationCompletedSchema({
    providers: [...KNOWN_PROVIDERS, "custom"],
    models: [...new Set(Object.values(KNOWN_MODELS).flat()), "custom"],
  }),
  category_config: CATEGORY_CONFIG_SCHEMA,
  process_crashed: PROCESS_CRASHED_SCHEMA,
} as const)

export const OMO_NATIVE_PROPERTY_ALLOWLISTS = Object.freeze(Object.fromEntries(
  Object.entries(OMO_NATIVE_EVENT_SCHEMAS).map(([eventName, properties]) => [
    eventName,
    Object.freeze(Object.keys(properties)),
  ]),
) as { readonly [EventName in keyof typeof OMO_NATIVE_EVENT_SCHEMAS]: readonly (keyof typeof OMO_NATIVE_EVENT_SCHEMAS[EventName] & string)[] })

export type OmoNativeEventName = keyof typeof OMO_NATIVE_EVENT_SCHEMAS
