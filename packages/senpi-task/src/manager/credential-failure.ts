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
/** The terminal error text: a credential failure names the provider and how to restore it. */
export function terminalFailureMessage(record: TaskRecord | null | undefined, failureMessage: string): string {
  const provider = record == null ? undefined : providerOf(record)
  if (provider === undefined || record == null || !isCredentialFailure(failureMessage, modelIdOf(record))) return failureMessage
  return `${failureMessage}\nCredentials for ${provider} were rejected; re-authenticate ${provider} (Provider authentication settings on the desktop, /login ${provider} in an interactive session) or re-add its API key, or pin this category to another provider in omo.json.`
}

export type RuntimeFallbackCandidates = {
  readonly remaining: readonly ResolvedModelRecord[]
  readonly skipped: readonly ResolvedModelRecord[]
}

/** The fallback list to walk after a failed turn, minus the failed provider's rungs when its credential is dead. */
export function runtimeFallbackCandidates(record: TaskRecord, failureMessage: string): RuntimeFallbackCandidates {
  const fallbacks = record.fallback_models ?? []
  const provider = providerOf(record)
  if (provider === undefined || !isCredentialFailure(failureMessage, modelIdOf(record))) return { remaining: fallbacks, skipped: [] }
  return {
    remaining: fallbacks.filter((model) => model.provider !== provider),
    skipped: fallbacks.filter((model) => model.provider === provider),
  }
}
