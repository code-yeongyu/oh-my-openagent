import type { ResolvedModelRecord, TaskRecord } from "../state"
import { isCredentialFailure, terminalFailureMessage, usageLimitScope } from "./credential-failure"
import { resetsOf } from "./parent-model-fallback"
import type { ResolvedChildPlan } from "./types"

type ModelRef = Pick<ResolvedModelRecord, "provider" | "model_id">

// The vendor that trains a model, read from its id: gateways (github-copilot, opencode, openrouter) serve
// several vendors under one provider id, so the provider alone cannot say which family a rung belongs to.
const VENDOR_BY_MODEL_ID: readonly (readonly [RegExp, string])[] = [
  [/claude/u, "anthropic"],
  [/(?:^|\/)(?:gpt|o\d|codex)/u, "openai"],
  [/gemini/u, "google"],
  [/glm/u, "zai"],
  [/kimi|(?:^|\/)k\d/u, "moonshot"],
  [/grok/u, "xai"],
  [/deepseek/u, "deepseek"],
  [/qwen/u, "qwen"],
  [/minimax/u, "minimax"],
]

function vendorFamily(model: ModelRef): string {
  const id = model.model_id.toLowerCase()
  return VENDOR_BY_MODEL_ID.find(([pattern]) => pattern.test(id))?.[1] ?? model.provider
}

/**
 * The vendor families a category child is confined to when the parent session's model falls outside them, or
 * `undefined` when the parent rung may be added (#12006). The lock is opt-in: only a category with
 * `provider_lock: true` (the shipped deep-low and deep-high carry it) is confined to its chain's own vendors;
 * every other chain, one-vendor or mixed, keeps the #10750 parent-model rung.
 */
export function parentRungLock(plan: ResolvedChildPlan, parent: ModelRef): string | undefined {
  if (plan.providerLock !== true) return undefined
  const chain = [plan.resolved_model, plan.requested_model, ...(plan.fallback_models ?? [])]
  const families = new Set(chain.flatMap((rung) => rung === undefined ? [] : [vendorFamily(rung)]))
  if (families.has(vendorFamily(parent))) return undefined
  return [...families].sort().join(", ")
}

export const PROVIDER_LOCK_EXHAUSTED = "provider_lock_exhausted" as const

type TerminalFailure = { readonly message: string; readonly kind?: string }
type TerminalFields = { readonly error_message: string; readonly failure_kind?: "child-unresponsive" | typeof PROVIDER_LOCK_EXHAUSTED }

// A locked child that ran out of usable rungs ends typed: its parent-model escape (#10750) was withheld on purpose.
export function terminalFailureFields(record: TaskRecord, failure: TerminalFailure): TerminalFields {
  const message = terminalFailureMessage(record, failure.message)
  const lock = record.provider_lock
  const unusable = usageLimitScope(failure.message) !== undefined || isCredentialFailure(failure.message, record.resolved_model?.model_id)
  if (lock !== undefined && unusable) {
    const category = record.category === undefined ? "this category" : `category "${record.category}"`
    const resets = resetsOf(failure.message)
    const until = resets === undefined ? "until its limit resets (the provider reported no reset time)" : `until ${resets}`
    return {
      error_message: `${message}\nEvery ${lock} model for ${category} is unavailable ${until}. The category is locked to ${lock} (provider_lock), so it never falls back to the parent session's model from another provider.`,
      failure_kind: PROVIDER_LOCK_EXHAUSTED,
    }
  }
  return { error_message: message, ...(failure.kind === "child-unresponsive" ? { failure_kind: failure.kind } : {}) }
}
