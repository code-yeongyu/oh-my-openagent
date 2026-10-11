import type { ResolvedModelRecord, TaskRecord } from "../state"

// A provider answer that no other model on the SAME provider can fix: the stored credential is
// rejected (401, an invalid key, a lapsed subscription) or can no longer be refreshed. Every
// remaining rung on that provider would fail the same way, so runtime fallback moves on to another
// provider.
const CREDENTIAL_REJECTED =
  /\b401\b|unauthori[sz]ed|invalid_grant|oauth refresh failed|subscription is required|invalid api key|incorrect api key|authentication (?:failed|error)/i
// A 403 is ambiguous: a provider also answers it for ONE model the key may not use (tier, region,
// preview access, an organization that must be verified for that model), which a sibling model on
// the same provider does not share. A 403 counts as a credential rejection only when it names the
// account, credential, key, organization or subscription AND does not scope itself to a model -
// a model-scoped or ambiguous 403 keeps the provider's other rungs.
const FORBIDDEN = /\b403\b|forbidden/i
const ACCOUNT_SCOPED_403 = /account|credential|token|api[ _-]?key|organization|subscription/i
const MODEL_SCOPED = /\bmodels?\b/i

// A spent usage, quota or billing limit. Scoped to one model when the text names a model, a model family
// or premium models (a Fable-only weekly cap, Copilot premium requests); otherwise the whole account is
// spent, so its other rungs fail the same way and go last.
const USAGE_LIMIT =
  /quota|usage[_ ]limit|\bhit\s+your\b[^.]*\blimit\b|\b(?:session|weekly|monthly|daily|hourly|\d+[- ]hour)\s+limit\b|limit\s+exhausted|insufficient[_ ](?:quota|credits?|balance)|credit[_ ]balance|credits?[_ ]required|billing|blocking_limit/i
const MODEL_SCOPED_LIMIT = /\bmodels?\b|\bpremium\b|\b(?:opus|sonnet|haiku|fable|mythos)\b/i

export type UsageLimitScope = "model" | "account"

export function usageLimitScope(message: string): UsageLimitScope | undefined {
  if (!USAGE_LIMIT.test(message)) return undefined
  return MODEL_SCOPED_LIMIT.test(message) ? "model" : "account"
}

export function isCredentialFailure(message: string, modelId?: string): boolean {
  if (CREDENTIAL_REJECTED.test(message)) return true
  if (!FORBIDDEN.test(message) || !ACCOUNT_SCOPED_403.test(message)) return false
  if (MODEL_SCOPED.test(message)) return false
  return modelId === undefined || !message.toLowerCase().includes(modelId.toLowerCase())
}

function providerOf(record: TaskRecord): string | undefined {
  if (record.resolved_model !== undefined) return record.resolved_model.provider
  const separator = record.model.indexOf("/")
  return separator > 0 ? record.model.slice(0, separator) : undefined
}

function modelIdOf(record: TaskRecord): string | undefined {
  if (record.resolved_model !== undefined) return record.resolved_model.model_id
  const separator = record.model.indexOf("/")
  return separator > 0 ? record.model.slice(separator + 1) : undefined
}

// The task manager has no session surface of its own (a desktop client, a headless run and the
// terminal all delegate), so the recovery names both re-authentication paths instead of a slash
// command only the interactive terminal handles.
/**
 * The terminal error text: a credential failure names the provider and how to restore it, and a spent
 * usage limit says the task stopped on it (and, when nothing was left, that no other model could take
 * over), so a single-model lane such as deep-high never ends on a bare provider error.
 */
export function terminalFailureMessage(record: TaskRecord | null | undefined, failureMessage: string): string {
  const provider = record == null ? undefined : providerOf(record)
  if (provider === undefined || record == null) return failureMessage
  if (isCredentialFailure(failureMessage, modelIdOf(record))) {
    return `${failureMessage}\nCredentials for ${provider} were rejected; re-authenticate ${provider} (Provider authentication settings on the desktop, /login ${provider} in an interactive session) or re-add its API key, or pin this category to another provider in omo.json.`
  }
  if (usageLimitScope(failureMessage) === undefined) return failureMessage
  const model = record.resolved_model === undefined ? record.model : `${provider}/${record.resolved_model.model_id}`
  const exhausted = runtimeFallbackCandidates(record, failureMessage).remaining.length === 0
    ? " No other model in its fallback chain could take over."
    : ""
  return `${failureMessage}\n${model} reached its usage limit, so this task stopped.${exhausted} Retry once the limit resets, or point this category at another provider or model in omo.json.`
}

export type RuntimeFallbackCandidates = {
  readonly remaining: readonly ResolvedModelRecord[]
  readonly skipped: readonly ResolvedModelRecord[]
  readonly limit?: UsageLimitScope
}

/** The fallback list to walk after a failed turn: a dead credential drops the failed provider's rungs, an account-wide usage limit moves them last. */
export function runtimeFallbackCandidates(record: TaskRecord, failureMessage: string): RuntimeFallbackCandidates {
  const fallbacks = record.fallback_models ?? []
  const provider = providerOf(record)
  if (provider !== undefined && isCredentialFailure(failureMessage, modelIdOf(record))) {
    return {
      remaining: fallbacks.filter((model) => model.provider !== provider),
      skipped: fallbacks.filter((model) => model.provider === provider),
    }
  }
  const limit = usageLimitScope(failureMessage)
  if (limit === undefined) return { remaining: fallbacks, skipped: [] }
  if (limit === "model" || provider === undefined) return { remaining: fallbacks, skipped: [], limit }
  return {
    remaining: [
      ...fallbacks.filter((model) => model.provider !== provider),
      ...fallbacks.filter((model) => model.provider === provider),
    ],
    skipped: [],
    limit,
  }
}
