import type { ModelRefusal, ModelRefusalReason, TaskRecord, TaskRunStats } from "../state"
import type { TaskRecordStore } from "../store"
import type { ManagedChildEvent } from "./child-handle"
import { isCredentialFailure, runtimeFallbackCandidates, terminalFailureMessage, usageLimitScope } from "./credential-failure"

const DETAIL_MAX = 200
const RESETS = /\bresets?\s+((?:at|in)\s+)?([^.\n;]+)/iu
// The provider declined the request itself (a content or usage policy), not the account or its capacity.
const POLICY_REFUSAL = /\bflagged\b|content[_ ]?(?:policy|filter|management)|usage[_ ]policy|safety (?:system|policy)|\brefus(?:ed|al)\b|\bviolat(?:es|ed|ion)\b/i
// Capacity: an overload, an outage, a timeout, a 5xx, or a rate limit that is not a spent quota.
const UNAVAILABLE = /overload|\b(?:500|502|503|504|529)\b|unavailable|capacity|timed? ?out|rate[_ ]limit|too many requests/i

export const MODEL_CHAIN_EXHAUSTED = "model_chain_exhausted" as const

const REASON_LABELS: Readonly<Record<ModelRefusalReason, string>> = {
  usage_limit: "usage limit",
  not_signed_in: "not signed in",
  refused: "refused",
  unavailable: "overloaded or unavailable",
  error: "failed",
}

type Outcome = {
  readonly status: string
  readonly killed?: boolean
  readonly failure?: { readonly kind: string }
}

/** The model itself failed the turn: not a kill, not a host or session failure. */
export function isModelTurnFailure(outcome: Outcome): boolean {
  return outcome.status === "error"
    && outcome.killed !== true
    && (outcome.failure?.kind === "child-turn-failed" || outcome.failure?.kind === "child-prompt-failed")
}

/** A model turn failure the manager may walk past: no tool call ran, so the next designated model can take the same prompt. */
export function isChainWalkable(outcome: Outcome, runStats: TaskRunStats | undefined): boolean {
  return isModelTurnFailure(outcome) && (runStats?.tool_calls ?? 0) === 0
}

function reasonOfFailure(message: string, modelId?: string): ModelRefusalReason {
  if (usageLimitScope(message) !== undefined) return "usage_limit"
  if (isCredentialFailure(message, modelId)) return "not_signed_in"
  if (POLICY_REFUSAL.test(message)) return "refused"
  if (UNAVAILABLE.test(message)) return "unavailable"
  return "error"
}

// The failure itself outranks the engine's hop label: senpi can route an account limit it retried through
// its transient lane, and the entry must still say "usage limit".
function reasonOfEngineFallback(event: ManagedChildEvent, detail: string | undefined): ModelRefusalReason {
  if (readString(event, "limit") !== undefined) return "usage_limit"
  if (detail !== undefined && reasonOfFailure(detail) !== "error") return reasonOfFailure(detail)
  switch (readString(event, "reason")) {
    case "billing":
      return "usage_limit"
    case "refusal":
      return "refused"
    case "transient":
      return "unavailable"
    default:
      return "error"
  }
}

function buildModelRefusal(input: {
  readonly model: string
  readonly reason: ModelRefusalReason
  readonly message?: string
  readonly at: string
}): ModelRefusal {
  const detail = input.message === undefined ? undefined : firstLine(input.message)
  const resets = input.message === undefined ? undefined : resetsOf(input.message)
  return {
    model: baseSelector(input.model),
    reason: input.reason,
    at: input.at,
    ...(detail === undefined ? {} : { detail }),
    ...(resets === undefined ? {} : { resets }),
  }
}

export function refusalOf(record: Pick<TaskRecord, "model" | "resolved_model">, message: string, at: string): ModelRefusal {
  return buildModelRefusal({ model: record.model, reason: reasonOfFailure(message, record.resolved_model?.model_id), message, at })
}

export function withRefusal<Record extends Pick<TaskRecord, "model_refusals">>(record: Record, refusal: ModelRefusal): Record {
  return { ...record, model_refusals: [...(record.model_refusals ?? []), refusal] }
}

/**
 * Record each designated model the child's own in-session fallback walks past. The failed turn that caused
 * the hop is remembered from its error message, so the entry carries the provider's words and reset time.
 */
export function observeModelRefusals(input: {
  readonly store: TaskRecordStore
  readonly taskId: string
  readonly now: () => number
}): (event: ManagedChildEvent) => void {
  const { store, taskId, now } = input
  let failed: string | undefined
  return (event) => {
    if (event.type === "message_end" && isAssistant(event.message)) {
      failed = failedTurnMessage(event.message)
      return
    }
    if (event.type !== "retry_fallback_applied") return
    const record = store.load(taskId)
    if (record == null) return
    const refusal = buildModelRefusal({
      model: readString(event, "from") ?? record.model,
      reason: reasonOfEngineFallback(event, failed),
      ...(failed === undefined ? {} : { message: failed }),
      at: new Date(now()).toISOString(),
    })
    failed = undefined
    store.mutate(taskId, (fresh) => withRefusal(fresh, refusal))
  }
}

type TerminalFields = { readonly error_message: string; readonly failure_kind?: "child-unresponsive" | typeof MODEL_CHAIN_EXHAUSTED }

/**
 * The terminal error of a failed run. When the designated chain is spent on a recognized refusal (a usage
 * limit, a missing or rejected credential, a policy refusal, an overload) the task fails typed and lists every
 * designated model it tried and why: it never runs on any other model, the parent session's included.
 */
export function terminalFailureFields(
  record: TaskRecord,
  failure: { readonly message: string; readonly kind?: string },
  modelFailure: boolean,
): TerminalFields {
  const message = terminalFailureMessage(record, failure.message)
  const final = refusalOf(record, failure.message, record.updated_at)
  if (!modelFailure || final.reason === "error" || runtimeFallbackCandidates(record, failure.message).remaining.length > 0) {
    return { error_message: message, ...(failure.kind === "child-unresponsive" ? { failure_kind: failure.kind } : {}) }
  }
  return { error_message: `${message}\n${describeExhaustedChain(record, [...(record.model_refusals ?? []), final])}`, failure_kind: MODEL_CHAIN_EXHAUSTED }
}

export function describeExhaustedChain(record: Pick<TaskRecord, "category" | "agent_type">, refusals: readonly ModelRefusal[]): string {
  const subject = record.category !== undefined
    ? `category "${record.category}"`
    : record.agent_type !== undefined ? `agent "${record.agent_type}"` : "this task"
  const lines = refusals.map((refusal) => `- ${refusal.model}: ${REASON_LABELS[refusal.reason]}${refusalSuffix(refusal)}`)
  return [`Every designated model for ${subject} was refused, and a child never runs on any other model:`, ...lines].join("\n")
}

function refusalSuffix(refusal: ModelRefusal): string {
  if (refusal.resets !== undefined) return ` (resets ${refusal.resets})`
  if (refusal.reason === "usage_limit" || refusal.detail === undefined) return ""
  return ` (${refusal.detail})`
}

function failedTurnMessage(message: Record<string, unknown>): string | undefined {
  if (message.stopReason !== "error" && message.stopReason !== "aborted") return undefined
  const text = typeof message.errorMessage === "string" && message.errorMessage.length > 0 ? message.errorMessage : undefined
  return text ?? `stopped with ${String(message.stopReason)}`
}

function isAssistant(message: unknown): message is Record<string, unknown> {
  return typeof message === "object" && message !== null && Reflect.get(message, "role") === "assistant"
}

function readString(event: ManagedChildEvent, key: string): string | undefined {
  const value = Reflect.get(event, key)
  return typeof value === "string" ? value : undefined
}

function firstLine(message: string): string | undefined {
  const line = message.split("\n").map((part) => part.trim()).find((part) => part.length > 0)
  if (line === undefined) return undefined
  return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line
}

function resetsOf(message: string): string | undefined {
  const match = RESETS.exec(message)
  const when = withoutUnbalancedParen(match?.[2]?.trim())
  return when === undefined || when.length === 0 ? undefined : `${match?.[1] ?? ""}${when}`
}

// `(resets 3:20am)` closes a parenthesis the match never opened; `resets 3pm (Asia/Seoul)` keeps its own.
function withoutUnbalancedParen(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const opened = value.split("(").length - 1
  const closed = value.split(")").length - 1
  return closed > opened && value.endsWith(")") ? value.slice(0, -1).trim() : value
}

function baseSelector(selector: string): string {
  const slash = selector.indexOf("/")
  const colon = selector.lastIndexOf(":")
  return colon > slash ? selector.slice(0, colon) : selector
}
