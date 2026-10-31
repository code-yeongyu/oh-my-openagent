/**
 * Session-start emulation of the first turn's request-auth resolution for one profile candidate.
 *
 * senpi resolves auth lazily, on the first request, and `modelRegistry.getAvailable()` lists every
 * provider with STORED credentials - including an OAuth login whose refresh token the provider now
 * rejects. The first turn goes through `ModelRuntime.streamSimple`, which (a) rotates over a
 * provider's credential SLOTS when it holds more than one account and rotation is allowed (a
 * pinned account wins; `credential-policy.ts` reads when rotation is off and only the flat
 * credential counts), and (b) resolves the model's own configured headers on top of the provider
 * credential. Both are reproduced here through the public `ModelRuntime.getAuth` overloads so the
 * walk skips what that turn could not use:
 *
 *   - provider scope: no eligible slot resolves (`refresh`: the stored login could not be
 *     refreshed; `credentials`: any other resolution failure, e.g. a failing `!command` key);
 *   - model scope (`request`): the provider credential resolved but this model's request
 *     configuration did not, so only that candidate is skipped and its siblings stay eligible.
 *
 * A refresh that failed transiently (senpi's `OAuthRefreshUnavailableError`: connection refused,
 * timeout, 408/429/5xx) says nothing about the sign-in, and the first turn retries it, so it never
 * skips the provider: skipping would move the whole session to the next provider (for a GPT rung,
 * the metered `openai` API lane) for its lifetime. The model-scope check still runs on that slot, so
 * a model whose own request configuration fails is skipped as before; only a model probe that is
 * itself cut short by the transient refresh leaves the candidate kept unchecked.
 *
 * Limits: whether a rotating pool actually fails over on the first turn depends on how senpi's pool
 * classifier reads the rejection (a 401/unauthorized/invalid-key answer fails over; a plain
 * `invalid_grant` body does not), and a slot the pool sidecar has blocked still counts here.
 *
 * Cost: each probe is the resolution the first turn would perform anyway (a token with less than
 * five minutes left is refreshed; a rejected refresh costs up to senpi's exchange timeout), once per
 * attempted account, sequentially. Raw errors carry URLs, response bodies, tokens and shell
 * commands, so only a class/code fingerprint leaves this module by default; `sanitizedAuthErrorDetail`
 * is for opt-in diagnostics.
 */

import type { CredentialRotationPolicy } from "./credential-policy"

export type AuthFailureReason = "refresh" | "credentials" | "request"

export type AuthFailure = {
  readonly provider: string
  readonly model: string
  readonly reason: AuthFailureReason
  /** Error class and code only (for example `ModelsError/oauth`), never the message. */
  readonly errorKind: string
  /** The thrown value, kept for opt-in diagnostics; never serialized into notices or details. */
  readonly error: unknown
}

/** A candidate kept although its login refresh failed transiently during the probe. */
export type RefreshUnavailableKeep = {
  readonly provider: string
  readonly model: string
  /** Class and code of senpi's transient-refresh error (for example `OAuthRefreshUnavailableError/oauth`). */
  readonly errorKind: string
  /** Closed transport fact from its cause chain (`ECONNREFUSED`, `http_503`, `TimeoutError`), or `unknown`. */
  readonly causeKind: string
}

type AuthOverrides = { readonly slotName?: string }

export type ProbeRuntime = {
  getAuth(target: unknown, overrides?: AuthOverrides): Promise<unknown>
}

/** The subset of senpi's `ModelRegistry` the probe reads; every member is optional so a host without it degrades. */
export type ProbeRegistry = {
  readonly modelRuntime?: unknown
  readonly authStorage?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function probeRuntime(registry: ProbeRegistry): ProbeRuntime | undefined {
  const runtime = registry.modelRuntime
  if (!isRecord(runtime) || typeof runtime["getAuth"] !== "function") return undefined
  return runtime as unknown as ProbeRuntime
}

type CredentialSlots = { readonly names: readonly string[]; readonly pinned: string | undefined }

// Mirrors senpi's pool reading: a credential with an `accounts` array is a pool of named slots and
// `pinned` names the only slot rotation may use; anything else is the flat single credential.
function credentialSlots(registry: ProbeRegistry, provider: string): CredentialSlots {
  const storage = registry.authStorage
  if (!isRecord(storage) || typeof storage["get"] !== "function") return { names: [], pinned: undefined }
  const credential: unknown = Reflect.apply(storage["get"], storage, [provider])
  if (!isRecord(credential) || !Array.isArray(credential["accounts"])) return { names: [], pinned: undefined }
  const names = credential["accounts"]
    .map((account: unknown) => (isRecord(account) && typeof account["name"] === "string" ? account["name"] : undefined))
    .filter((name): name is string => name !== undefined)
  const pinned = credential["pinned"]
  return { names, pinned: typeof pinned === "string" && names.includes(pinned) ? pinned : undefined }
}

function errorKind(error: unknown): string {
  if (!(error instanceof Error)) return typeof error
  const code = (error as Error & { code?: unknown }).code
  return typeof code === "string" ? `${error.name}/${code}` : error.name
}

// senpi raises every credential-resolution failure as `ModelsError` (codes such as `auth`/`oauth`);
// a model's configured header fails with a plain error. Matched by name, not `instanceof`, because
// the host and this bundle can load different copies of the class.
function isCredentialResolutionError(error: unknown): boolean {
  return error instanceof Error && error.name === "ModelsError" && typeof (error as Error & { code?: unknown }).code === "string"
}

function providerFailureReason(error: unknown): AuthFailureReason {
  // senpi maps every OAuth refresh failure onto `ModelsError` code "oauth"; a transient one never
  // reaches here (see `isRefreshUnavailable`), so this is a refused refresh.
  return error instanceof Error && (error as Error & { code?: unknown }).code === "oauth" ? "refresh" : "credentials"
}

// senpi marks its transient refresh failure with this global symbol (not `instanceof`, because the
// host and this bundle can load different copies of the class) and may wrap it, so the cause chain
// is walked the way senpi's own `isOAuthRefreshUnavailableError` walks it.
const REFRESH_UNAVAILABLE = Symbol.for("senpi.oauthRefreshUnavailable")
const MAX_CAUSE_LINKS = 16

function refreshUnavailableError(error: unknown): object | undefined {
  const seen = new Set<unknown>()
  let current = error
  while (isRecord(current) && !seen.has(current) && seen.size < MAX_CAUSE_LINKS) {
    seen.add(current)
    if (Reflect.get(current, REFRESH_UNAVAILABLE) === true) return current
    current = Reflect.get(current, "cause")
  }
  return undefined
}

// Only closed facts (an error code, an HTTP status, a timeout class) leave the cause chain; never a
// message, URL or body.
function transientCauseKind(marked: object): string {
  const seen = new Set<unknown>()
  let current: unknown = Reflect.get(marked, "cause")
  while (isRecord(current) && !seen.has(current) && seen.size < MAX_CAUSE_LINKS) {
    seen.add(current)
    const code = Reflect.get(current, "code")
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code
    const status = Reflect.get(current, "status")
    if (typeof status === "number" && Number.isInteger(status)) return `http_${status}`
    if (Reflect.get(current, "name") === "TimeoutError") return "TimeoutError"
    current = Reflect.get(current, "cause")
  }
  return "unknown"
}

/**
 * Returns the failure that would stop the first turn on this candidate, or `undefined` when the
 * candidate is usable. `model` is the registry's model object for `provider`/`modelId`.
 * `onRefreshUnavailable` hears about a candidate kept despite a transient refresh failure.
 */
export async function probeRequestAuth(
  registry: ProbeRegistry,
  runtime: ProbeRuntime,
  mayRotate: CredentialRotationPolicy,
  provider: string,
  modelId: string,
  model: unknown,
  onRefreshUnavailable?: (keep: RefreshUnavailableKeep) => void,
): Promise<AuthFailure | undefined> {
  const slots = credentialSlots(registry, provider)
  // The engine's selection: without rotation only the flat credential is used; with it, a pin is
  // the only slot, otherwise any resolving slot serves.
  const candidates: (string | undefined)[] = !mayRotate(provider)
    ? [undefined]
    : slots.pinned !== undefined
      ? [slots.pinned]
      : slots.names.length > 0
        ? [...slots.names]
        : [undefined]

  let resolvedSlot: string | undefined
  let resolved = false
  let unavailable: { readonly slot: string | undefined } | undefined
  let lastError: unknown
  for (const slot of candidates) {
    try {
      // `undefined` here means the provider needs no credential (headers-only compatibility
      // config), which the first turn also accepts; only a throw is a failure.
      await runtime.getAuth(provider, slot === undefined ? {} : { slotName: slot })
      resolved = true
      resolvedSlot = slot
      break
    } catch (error) {
      lastError = error
      const marked = refreshUnavailableError(error)
      if (marked !== undefined && unavailable === undefined) unavailable = { slot }
    }
  }
  if (!resolved && unavailable === undefined) {
    return { provider, model: modelId, reason: providerFailureReason(lastError), errorKind: errorKind(lastError), error: lastError }
  }
  // A slot whose refresh is only temporarily unavailable may serve the first turn after its retry,
  // so the provider stays eligible and the model-scope check runs on that slot.
  const modelSlot = resolved ? resolvedSlot : unavailable?.slot
  const keep = (marked: object): undefined => {
    onRefreshUnavailable?.({ provider, model: modelId, errorKind: errorKind(marked), causeKind: transientCauseKind(marked) })
    return undefined
  }

  try {
    await runtime.getAuth(model, modelSlot === undefined ? {} : { slotName: modelSlot })
  } catch (error) {
    const marked = refreshUnavailableError(error)
    if (marked !== undefined) return keep(marked)
    // After a transient provider probe the model probe re-runs the credential resolution; a failure
    // there is still provider-scope (`refresh` or `credentials`), anything else is this model's
    // request configuration.
    const reason = !resolved && isCredentialResolutionError(error) ? providerFailureReason(error) : "request"
    return { provider, model: modelId, reason, errorKind: errorKind(error), error }
  }
  // The model probe resolved the credential itself, so a transient provider-probe refresh has since
  // succeeded and nothing is left for the first turn to retry.
  return undefined
}

const DETAIL_MAX_LENGTH = 240

// Any field whose NAME says it carries a secret, in `name: value`, `name=value` or JSON `"name": "value"`
// form; the whole value is dropped, whatever its length.
const SECRET_FIELD =
  /(["']?)\b([\w-]*(?:token|secret|password|passwd|authorization|api[_-]?key|apikey|access[_-]?key|refresh|credential|cookie|session)[\w-]*)\1(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}&]+(?:\s+[^\s,;}&]+)?)/gi

// One redacted line per error in the cause chain. Shell commands and response bodies are dropped
// whole (a `!command` key or header can embed a secret), secret-named fields lose their value
// (including a two-word `Authorization: Bearer <token>`), bearer/basic schemes lose their
// credential, URL userinfo and query strings are dropped, remaining long opaque strings are masked,
// and stacks never appear.
function sanitizedLine(error: unknown): string {
  const name = error instanceof Error ? `${error.name}: ` : ""
  const message = error instanceof Error ? error.message : String(error)
  // The class name is kept verbatim (it can itself read like a secret-named field, for example
  // `OAuthRefreshExchangeError:`); only the message is redacted.
  return (name + message
    .split("\n")[0]!
    .replace(/shell command:.*$/i, "shell command: <redacted>")
    .replace(/\b(body|stack|details)=.*$/i, "$1=<redacted>")
    .replace(SECRET_FIELD, "$1$2$1$3<redacted>")
    .replace(/\b(bearer|basic)\s+[^\s,;"']+/gi, "$1 <redacted>")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi, "$1<redacted>@")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#]*)[?#][^\s]*/gi, "$1?<redacted>")
    .replace(/[A-Za-z0-9_+/=-]{24,}/g, "<redacted>"))
    .slice(0, DETAIL_MAX_LENGTH)
}

/** Redacted, bounded description of an auth failure for opt-in (debug) diagnostics only. */
export function sanitizedAuthErrorDetail(error: unknown): string {
  const lines: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== undefined && current !== null && !seen.has(current) && lines.length < 4) {
    seen.add(current)
    lines.push(sanitizedLine(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return lines.join(" <- ")
}
