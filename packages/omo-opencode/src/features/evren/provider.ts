import { log } from "../../shared/logger"

export const EVREN_PROVIDER_ID = "evren"
export const EVREN_BASE_URL = "https://evren-llmapi.ssyz.org.tr/v1"

export const EVREN_OUTPUT_LIMIT = 65536

export type EvrenModelConfig = {
  name: string
  limit: { context: number; output: number }
  modalities?: { input: string[] }
}

export type EvrenProviderConfig = {
  npm: string
  name: string
  options: { baseURL: string }
  models: Record<string, EvrenModelConfig>
}

// The context values are a FALLBACK: compaction uses them until the live
// /models refresh reports a real serving limit for the model (see
// live-context-limits.ts). OpenCode's config schema requires limit.output
// whenever a limit block is present (1.18.33+ hard-fails startup without
// it), and its request layer clamps max_tokens to OUTPUT_TOKEN_MAX (32000)
// regardless, so declaring 65536 satisfies validation without throttling:
// the gateway does not cap output per model.
function textOnly(name: string, context: number): EvrenModelConfig {
  return { name, limit: { context, output: EVREN_OUTPUT_LIMIT } }
}

function textAndImage(name: string, context: number): EvrenModelConfig {
  return {
    name,
    limit: { context, output: EVREN_OUTPUT_LIMIT },
    modalities: { input: ["text", "image"] },
  }
}

function buildEvrenProviderConfig(): EvrenProviderConfig {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "EVREN LLM",
    options: { baseURL: EVREN_BASE_URL },
    models: {
      "auto": textOnly("EVREN Auto", 250000),
      "glm-5.3": textOnly("GLM 5.3", 250000),
      "deepseek-v4-flash": textOnly("DeepSeek V4 Flash", 250000),
      "qwen3.8-flash-next": textAndImage("Qwen3.8 Flash Next", 250000),
      "gemma-4-31b": textAndImage("Gemma 4 31B", 250000),
      "qwen3-vl-30b": textAndImage("Qwen3 VL 30B", 250000),
    },
  }
}

function deepFreeze(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
}

const evrenProviderConfig = buildEvrenProviderConfig()
deepFreeze(evrenProviderConfig)

/**
 * Built-in EVREN LLM provider entry (Turkish SSB gateway, OpenAI-compatible).
 * Frozen deeply; applyBuiltinEvrenProvider injects a fresh clone per call so
 * callers can never mutate this shared constant.
 */
export const EVREN_PROVIDER_CONFIG: EvrenProviderConfig = evrenProviderConfig

function cloneEvrenProviderConfig(): EvrenProviderConfig {
  return structuredClone(EVREN_PROVIDER_CONFIG)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Injects the built-in EVREN provider into an OpenCode config object.
 *
 * Injection is unconditional so the provider is always selectable in
 * `/connect`. The injected entry carries no credential, so the provider stays
 * inert until the user adds an API key there; consent is enforced at first use
 * in the TUI, not by hiding the provider. A missing config.provider map is
 * created; a non-object provider value is left untouched, and an existing
 * evren entry is never overwritten. opts.liveContextLimits (gateway-reported
 * context limits from the provider-models cache) override the fallback limits
 * of the injected clone only. Never throws.
 */
export interface ApplyBuiltinEvrenProviderOptions {
  liveContextLimits?: Record<string, number>
}

export function applyBuiltinEvrenProvider(
  config: Record<string, unknown>,
  opts?: ApplyBuiltinEvrenProviderOptions,
): void {
  try {
    const existing = config.provider
    if (existing !== undefined && !isRecord(existing)) return
    const provider = existing === undefined
      ? (config.provider = {} as Record<string, unknown>)
      : existing
    if (Object.prototype.hasOwnProperty.call(provider, EVREN_PROVIDER_ID)) return
    const injected = cloneEvrenProviderConfig()
    for (const [modelID, context] of Object.entries(opts?.liveContextLimits ?? {})) {
      const model = injected.models[modelID]
      if (model && Number.isFinite(context) && context > 0) {
        model.limit.context = Math.floor(context)
      }
    }
    provider[EVREN_PROVIDER_ID] = injected
  } catch (error) {
    log("[evren-provider] Error applying built-in evren provider", {
      error: String(error),
    })
  }
}
