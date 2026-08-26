import { createHash, randomBytes } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  DEFAULT_POSTHOG_HOST,
  type TelemetryEnv,
  type TelemetryProductConfig,
} from "@oh-my-opencode/telemetry-core"
import { CURATED_READONLY_AGENT_NAMES } from "@oh-my-opencode/senpi-task/agents-builtin"
import { BUILTIN_CATEGORY_DEFAULTS } from "@oh-my-opencode/senpi-task/category-builtins"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { CATEGORY_CONFIG_SCHEMA } from "./category-config-schema"
import { ALL_KNOWN_MODEL_IDS, KNOWN_MODELS, KNOWN_PROVIDERS, type KnownProvider } from "./model-vocabulary"
import { buildDelegationCompletedSchema } from "./delegation-schema"
import { PARALLELISM_SUMMARY_SCHEMA } from "./parallelism-schema"

export const OMO_NATIVE_POSTHOG_API_KEY = "phc_r6UYQzNZcGYSzKw4PxCiVrZepGqV3dw9qcvcKtRNUWAn"

// Schema version shared by every native client. One constant, because two hardcoded literals in two
// clients half-apply a bump: a session row and a task row would disagree about their own schema.
// v3: every event additionally carries the shared attribution properties `surface` (cli | desktop)
// and `install_id` (random per-installation id shared by CLI and Desktop through the agent home).
export const OMO_NATIVE_SCHEMA_VERSION = 3

export { ALL_KNOWN_MODEL_IDS, KNOWN_MODELS, KNOWN_PROVIDERS } from "./model-vocabulary"
export type { KnownProvider } from "./model-vocabulary"

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
  "ast-grep", "coding-agent-sessions", "dag-library", "data-scientist", "debugging", "frontend", "git-master",
  "give-me-tips", "hyperplan", "init-deep", "lsp-setup", "mass-ulw", "onboarding", "programming", "refactor",
  "remove-ai-slops",
  "review-work", "ulw-execute", "ultimate-browsing", "ultrawork", "ulw-loop", "ulw-plan", "ulw-research",
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
  parallelism_summary: PARALLELISM_SUMMARY_SCHEMA,
  delegation_completed: buildDelegationCompletedSchema({
    providers: [...KNOWN_PROVIDERS, "custom"],
    models: [...new Set(Object.values(KNOWN_MODELS).flat()), "custom"],
  }),
  category_config: CATEGORY_CONFIG_SCHEMA,
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

export function createOmoNativeProductConfig(): TelemetryProductConfig {
  return {
    cacheDirName: "omo-native",
    defaultApiKey: OMO_NATIVE_POSTHOG_API_KEY,
    defaultHost: DEFAULT_POSTHOG_HOST,
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

/**
 * Mask a provider/model pair for export.
 *
 * The two halves carry different privacy weight, so they are masked by different rules:
 * - `provider` is user-authored configuration. Anything outside `KNOWN_PROVIDERS` becomes `custom`,
 *   because a self-hosted gateway name can identify a company or a person.
 * - `model_id` is a public product name. It survives whenever it matches the shipped vocabulary
 *   exactly, no matter which provider routed it, so a known model reached through OpenRouter,
 *   LiteLLM, or a private gateway stays readable instead of collapsing to `custom`.
 *
 * A model id outside the vocabulary - a fine-tune, an internal codename - is always `custom`.
 * This is the contract published in `docs/reference/senpi-telemetry.md`.
 */

const INSTALL_ID_FILE_NAME = "install-id"
const INSTALL_ID_PATTERN = /^[0-9a-f]{64}$/
const fallbackInstallIds = new Map<string, string>()

/** Where the event came from: the standalone CLI, or a runtime embedded in OmO Desktop. */
export type OmoNativeSurface = "cli" | "desktop"

export type OmoNativeAttributionInput = {
  readonly env?: TelemetryEnv
  /** Injected by tests; defaults to the runtime's resolved agent home. */
  readonly stateDir?: string
}

/**
 * Shared attribution for every omo-native event. `install_id` is a random 64-hex id stored next to
 * the session-id salt, so the CLI and the Desktop-bundled runtime on one machine converge on one id
 * without deriving anything from the machine itself. A valid `OMO_NATIVE_INSTALL_ID` env override
 * wins, because a Desktop host pins a remote (SSH/WSL) runtime to ITS local installation id.
 * `OMO_NATIVE_SURFACE=desktop` is set by the Desktop host; anything else is the CLI.
 */
export function getOmoNativeAttribution(input: OmoNativeAttributionInput = {}): {
  readonly surface: OmoNativeSurface
  readonly install_id: string
} {
  const env = input.env ?? process.env
  const surface: OmoNativeSurface = env["OMO_NATIVE_SURFACE"]?.trim() === "desktop" ? "desktop" : "cli"
  const envInstallId = env["OMO_NATIVE_INSTALL_ID"]?.trim() ?? ""
  const install_id = INSTALL_ID_PATTERN.test(envInstallId)
    ? envInstallId
    : readOrCreateInstallId(join(input.stateDir ?? getOmoNativeStateDir(env), INSTALL_ID_FILE_NAME))
  return { surface, install_id }
}

/** Attach the shared attribution to a product config; the fixed identity keys still win downstream. */
export function withOmoNativeAttribution(
  product: TelemetryProductConfig,
  input: OmoNativeAttributionInput = {},
): TelemetryProductConfig {
  return {
    ...product,
    additionalProperties: { ...product.additionalProperties, ...getOmoNativeAttribution(input) },
  }
}

export function maskProviderAndModel(provider: string, modelId: string): { provider: string; model_id: string } {
  return {
    provider: isKnownProvider(provider) ? provider : "custom",
    model_id: ALL_KNOWN_MODEL_IDS.has(modelId) ? modelId : "custom",
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

function readOrCreateInstallId(path: string): string {
  const persisted = readInstallId(path)
  if (persisted !== undefined) return persisted

  const installId = randomBytes(SALT_LENGTH).toString("hex")
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${installId}\n`, { flag: "wx", mode: 0o600 })
    fallbackInstallIds.delete(path)
    return installId
  } catch {
    const concurrentlyCreated = readInstallId(path)
    if (concurrentlyCreated !== undefined) return concurrentlyCreated
    try {
      writeFileSync(path, `${installId}\n`, { flag: "w", mode: 0o600 })
      fallbackInstallIds.delete(path)
      return installId
    } catch {
      const fallback = fallbackInstallIds.get(path)
      if (fallback !== undefined) return fallback
      fallbackInstallIds.set(path, installId)
      return installId
    }
  }
}

function readInstallId(path: string): string | undefined {
  try {
    const value = readFileSync(path, "utf8").trim()
    return INSTALL_ID_PATTERN.test(value) ? value : undefined
  } catch {
    // Missing or malformed id is repaired by the caller. Telemetry identity must never block the host.
    return undefined
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
