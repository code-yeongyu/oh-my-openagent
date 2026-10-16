import { maskProviderAndModel } from "./product-identity"
import { SEMCONV_MAP } from "./semconv-map"

/**
 * OpenTelemetry GenAI attribute projections of one assistant turn (plan D-P). The PostHog path keeps
 * today's properties; these are the wire values the collector path sends.
 */

type UsageLike = {
  readonly input?: unknown
  readonly output?: unknown
  readonly cacheRead?: unknown
  readonly cacheWrite?: unknown
  readonly reasoning?: unknown
  readonly totalTokens?: unknown
}

export type GenAiUsageAttributes = {
  readonly "gen_ai.usage.input_tokens": number
  readonly "gen_ai.usage.cache_read.input_tokens": number
  readonly "gen_ai.usage.cache_creation.input_tokens": number
  readonly "gen_ai.usage.output_tokens": number
  readonly "gen_ai.usage.reasoning.output_tokens"?: number
  readonly "omo.usage.total_tokens": number
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * senpi's usage is EXCLUSIVE on input (`usage.input` = the provider's non-cached prompt tokens, in the
 * Anthropic and OpenAI parsers alike) and inclusive on output (`usage.output` already contains the
 * reasoning tokens). The GenAI conventions want the inclusive input count, so the cache reads and
 * writes are added back; output passes through. There is no convention for a grand total, so senpi's
 * `totalTokens` travels as `omo.usage.total_tokens`.
 */
export function toGenAiUsage(usage: UsageLike): GenAiUsageAttributes {
  const input = count(usage.input)
  const cacheRead = count(usage.cacheRead)
  const cacheWrite = count(usage.cacheWrite)
  return {
    "gen_ai.usage.input_tokens": input + cacheRead + cacheWrite,
    "gen_ai.usage.cache_read.input_tokens": cacheRead,
    "gen_ai.usage.cache_creation.input_tokens": cacheWrite,
    "gen_ai.usage.output_tokens": count(usage.output),
    ...(usage.reasoning === undefined ? {} : { "gen_ai.usage.reasoning.output_tokens": count(usage.reasoning) }),
    "omo.usage.total_tokens": count(usage.totalTokens),
  }
}

type AssistantMessageLike = {
  readonly api?: unknown
  readonly provider?: unknown
  readonly model?: unknown
  readonly responseModel?: unknown
}

export type GenAiModelAttributes = {
  readonly "omo.provider": string
  readonly "gen_ai.provider.name": string
  readonly "omo.model_id": string
  readonly "gen_ai.response.model"?: string
  readonly "gen_ai.request.model"?: string
}

/**
 * APIs whose parser always records the provider-reported model: the Anthropic Messages stream carries
 * `message.model` in its mandatory `message_start` event, and senpi's parser sets
 * `responseModel` exactly when that id differs from the request. For these, a message without
 * `responseModel` was served by the requested model. Other parsers (OpenAI completions) set
 * `responseModel` only when a chunk names a different model, so its absence proves nothing.
 */
const MODEL_REPORTING_APIS: ReadonlySet<string> = new Set(["anthropic-messages"])

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function maskModel(model: string): string {
  return maskProviderAndModel("custom", model).model_id
}

/** `gen_ai.provider.name` for our closed provider id, through the semconv-map VALUE table. */
export function genAiProviderName(maskedProvider: string): string {
  const row = SEMCONV_MAP.values["gen_ai.provider.name"]?.rows.find((entry) => entry.id === maskedProvider)
  if (row === undefined) throw new Error(`semconv-map.json has no gen_ai.provider.name row for ${maskedProvider}`)
  return row.wire
}

/**
 * The model attributes of one turn. `omo.model_id` keeps today's meaning (senpi's `message.model`:
 * the requested id, or an allowed fallback the parser promoted into it). `gen_ai.response.model` is
 * what the provider reported: `responseModel` when the parser recorded a different id, else
 * `message.model` when the API's parser contract makes it the served model; absent otherwise.
 * `gen_ai.request.model` is the requested id: the caller's configured model when known, else
 * `message.model` when no promotion can have happened; never copied from the response. Every value
 * is masked to the closed vocabulary.
 */
export function toGenAiModel(message: AssistantMessageLike, requestedModel?: string): GenAiModelAttributes {
  const provider = text(message.provider) ?? "custom"
  const model = text(message.model) ?? "custom"
  const responseModel = text(message.responseModel)
  const masked = maskProviderAndModel(provider, model)
  const reported = responseModel ?? (MODEL_REPORTING_APIS.has(text(message.api) ?? "") ? model : undefined)
  // A promotion copies the reported id into message.model, so model === responseModel marks it; without
  // a reported id, or with a reported id that was not promoted, message.model is still the request.
  const promoted = responseModel !== undefined && responseModel === model
  const requested = text(requestedModel) ?? (promoted ? undefined : model)
  return {
    "omo.provider": masked.provider,
    "gen_ai.provider.name": genAiProviderName(masked.provider),
    "omo.model_id": masked.model_id,
    ...(reported === undefined ? {} : { "gen_ai.response.model": maskModel(reported) }),
    ...(requested === undefined ? {} : { "gen_ai.request.model": maskModel(requested) }),
  }
}
