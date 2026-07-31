/**
 * Refusal detection for the fallback-architect nudge.
 *
 * `isRefusalLikeMessage` intentionally mirrors senpi's own `isClassifierRefusal`
 * (senpi repo `packages/ai/src/utils/stop-details.ts`), which is the predicate senpi uses to
 * classify a retry as `reason: "refusal"`. That module lives in `@earendil-works/pi-ai`, which is
 * not a runtime dependency of this adapter, so the semantics are duplicated here on purpose.
 * Keep the two in sync by hand when senpi changes its classifier.
 *
 * Every payload arrives untyped from the host, so the shapes below are local structural types.
 * The adapter never imports senpi runtime modules.
 */

const ANTHROPIC_POLICY_REFUSAL_PATTERN =
  /This request triggered restrictions on [\s\S]+? and was blocked under Anthropic's Usage Policy\b/i

const REFUSAL_STOP_DETAIL_TYPES = new Set(["refusal", "sensitive"])
const REFUSAL_ELIGIBLE_STOP_REASONS = new Set(["error", "toolUse"])

export const FABLE_FIVE_MODEL_ID = "claude-fable-5"

export interface FallbackModelDescriptor {
  provider?: string
  id: string
}

export interface FallbackModelSelectEvent {
  type: "model_select"
  model: FallbackModelDescriptor
  previousModel?: FallbackModelDescriptor
  source: string
}

export interface FallbackMessageEndEvent {
  type: "message_end"
  message: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isModelDescriptor(value: unknown): value is FallbackModelDescriptor {
  return isRecord(value) && typeof value["id"] === "string"
}

export function isRefusalLikeMessage(message: unknown): boolean {
  if (!isRecord(message) || message["role"] !== "assistant") return false

  // Order matters and mirrors senpi: the stop reason is checked FIRST, so a message that ended for
  // another reason (an abort, a normal stop) can never be read as a refusal just because it still
  // carries stale stopDetails.
  const stopReason = message["stopReason"]
  if (typeof stopReason !== "string" || !REFUSAL_ELIGIBLE_STOP_REASONS.has(stopReason)) return false

  const stopDetails = message["stopDetails"]
  if (isRecord(stopDetails) && typeof stopDetails["type"] === "string" && REFUSAL_STOP_DETAIL_TYPES.has(stopDetails["type"])) {
    return true
  }

  const errorMessage = message["errorMessage"]
  return typeof errorMessage === "string" && ANTHROPIC_POLICY_REFUSAL_PATTERN.test(errorMessage)
}

export function isFableFiveModel(model: unknown): model is FallbackModelDescriptor {
  return isModelDescriptor(model) && model.id === FABLE_FIVE_MODEL_ID
}

export function isModelSelectEvent(payload: unknown): payload is FallbackModelSelectEvent {
  if (!isRecord(payload) || payload["type"] !== "model_select") return false
  if (typeof payload["source"] !== "string") return false
  if (!isModelDescriptor(payload["model"])) return false
  const previousModel = payload["previousModel"]
  return previousModel === undefined || isModelDescriptor(previousModel)
}

export function isMessageEndEvent(payload: unknown): payload is FallbackMessageEndEvent {
  return isRecord(payload) && payload["type"] === "message_end" && isRecord(payload["message"])
}

export function formatModelSelector(model: FallbackModelDescriptor): string {
  return model.provider === undefined ? model.id : `${model.provider}/${model.id}`
}
