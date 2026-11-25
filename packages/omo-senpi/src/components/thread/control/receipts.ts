import type { ThreadToolName, ThreadToolResult } from "../contracts"
import { gatewaySchemaRefusal } from "../errors"
import { GATEWAY_RECEIPT_RETENTION_MS } from "../gateway/constants"
import { hashArgs } from "../gateway/hash-args"
import { isLockWaitExceeded } from "../gateway/lock-wait"
import type { GatewayStore } from "../gateway/store"
import { thrown, UNEXPECTED_FAILURE_MESSAGE } from "../sdk-core/failures"
import { failure, uncertainFailure, uncertainNote } from "../tools/internals"
import { currentResult } from "../tools/thread-row"

/** How many keys a surface keeps for recovering receipts whose admission reply was lost. */
export const RECEIPT_RECOVERY_MAX_KEYS = 4_096

/**
 * The repeat horizon of a control call's idempotency key (#14951): for this long after a keyed call is admitted, a repeat
 * under the same key answers that call's first outcome and acts no second time; a repeat with other arguments is
 * `idempotency_conflict`. Receipts leave the store by time only, at this horizon, so a key reused after it is a new call.
 * Every answer to a call that named its key carries `receipt_expires_at`, so a caller decides without this constant.
 */
export const RECEIPT_HORIZON_MS = GATEWAY_RECEIPT_RETENTION_MS

/** The calls that may run again under a key whose earlier run is uncertain: the call itself finds what the first run did. */
const RETRIES_UNCERTAIN: ReadonlySet<ThreadToolName> = new Set(["thread_create"])

export type ReceiptScope = {
  readonly principal: string
  readonly operation: ThreadToolName
  readonly idempotency_key: string
}

export type Admission =
  | {
      readonly kind: "run"
      readonly retrying?: { readonly error_note: string | null }
      /** When this call's receipt leaves the store: admission time plus the horizon. */
      readonly expires_at: number
    }
  | { readonly kind: "answer"; readonly result: ThreadToolResult }

/** The answer to a call that named its key, with when its receipt expires (`RECEIPT_HORIZON_MS`). */
export const withReceiptExpiry = (result: ThreadToolResult, expiresAt: number): ThreadToolResult => ({
  ...result,
  receipt_expires_at: new Date(expiresAt).toISOString(),
})

/**
 * The one receipt protocol of a thread control call (#14951): a call under a key is admitted through the gateway store's
 * receipts, a repeat under the same key answers the first outcome and runs nothing, and the outcome is settled under the
 * key once the call ran. The thread tools and the thread SDK each hold one instance and run every control through it, so a
 * key means the same on every surface.
 */
/**
 * What a receipt records of a failed call, and so what a retry under its key replays (B8): an expected refusal's own
 * text (a schema refusal, `host_unavailable:`, `unsupported:`), never an unexpected exception's message.
 */
function failureNote(error: unknown): string {
  if (thrown(error).error.code === "internal_error") return UNEXPECTED_FAILURE_MESSAGE
  return error instanceof Error ? error.message : String(error)
}

export function createReceipts(
  store: Pick<GatewayStore, "toolReceiptBegin" | "toolReceiptSettle">,
  now: () => number,
  /** Where an unexpected store or call exception goes (B8); absent, nowhere. */
  onUnexpected?: (error: unknown) => void,
) {
  // Receipts this process began but could not settle (the store gave up at its lock-wait bound): the row stays `prepared`
  // under this instance, which would answer `idempotency_in_progress` forever. A retry of such a key is
  // `idempotency_uncertain` with the note instead.
  const unsettled = new Map<string, string>()
  // Keys whose receipt admission failed without a reply: the store may still have committed the prepared row (its worker
  // exited after the commit), which a retry would read as `in_progress` forever. Nothing ran for such a call, so a retry
  // that finds that row while no call of this instance runs the key takes it up and runs the call. Each key is kept until
  // the receipt it may have left expires, at most `RECEIPT_RECOVERY_MAX_KEYS` at once: when full, a call under a new key is
  // refused before its admission, so no key that may still need recovering is ever dropped.
  const unanswered = new Map<string, number>()
  // Keys whose admission is awaiting the store, with how many calls await it: each holds a slot until the store answers.
  const admitting = new Map<string, number>()
  const running = new Set<string>()
  const heldSlots = (): number => {
    let held = unanswered.size
    for (const key of admitting.keys()) if (!unanswered.has(key)) held++
    return held
  }
  const recoverable = (key: string, at: number): boolean => {
    const until = unanswered.get(key)
    if (until !== undefined && until <= at) unanswered.delete(key)
    return unanswered.has(key)
  }
  const recoveryFull = (at: number): boolean => {
    if (heldSlots() < RECEIPT_RECOVERY_MAX_KEYS) return false
    for (const [key, until] of unanswered) if (until <= at) unanswered.delete(key)
    return heldSlots() >= RECEIPT_RECOVERY_MAX_KEYS
  }
  const releaseAdmitting = (key: string): void => {
    const calls = admitting.get(key) ?? 0
    if (calls <= 1) admitting.delete(key)
    else admitting.set(key, calls - 1)
  }
  const keyOf = (scope: ReceiptScope) => `${scope.principal}\u0000${scope.operation}\u0000${scope.idempotency_key}`
  const unrecorded = (scope: ReceiptScope, what: string) => (settleError: unknown) => {
    onUnexpected?.(settleError)
    unsettled.set(keyOf(scope), `${what}, and its receipt could not be recorded.`)
  }

  /** `explicit`: the caller named the key, so its answers carry `receipt_expires_at`. */
  async function admit(scope: ReceiptScope, value: unknown, explicit = false): Promise<Admission> {
    // Nothing has run yet, so a store that cannot admit the receipt fails the call as data: the store lock held past its
    // wait bound is `overloaded`, any other store failure `internal_error`.
    const key = keyOf(scope)
    const at = now()
    // The slot is taken before the admission is awaited, so overlapping calls cannot all pass the check.
    if (!recoverable(key, at) && !admitting.has(key) && recoveryFull(at))
      return {
        kind: "answer",
        result: failure(
          "overloaded",
          `${RECEIPT_RECOVERY_MAX_KEYS} earlier calls on this surface failed before the gateway store answered and may still need recovering; nothing ran.`,
          "Retry those calls under their own idempotency keys, then retry this one.",
          { budget: "receipt_recovery", max_keys: RECEIPT_RECOVERY_MAX_KEYS },
        ),
      }
    let admission: Awaited<ReturnType<typeof store.toolReceiptBegin>>
    admitting.set(key, (admitting.get(key) ?? 0) + 1)
    try {
      admission = await store.toolReceiptBegin({
        ...scope,
        now: at,
        args_hash: hashArgs(value),
        retry_uncertain: RETRIES_UNCERTAIN.has(scope.operation),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isLockWaitExceeded(error))
        return {
          kind: "answer",
          result: failure(
            "overloaded",
            `The gateway store is locked by another process; nothing ran: ${message}`,
            "Wait a few seconds, then retry the call.",
          ),
        }
      const schema = gatewaySchemaRefusal(error)
      if (schema !== undefined) return { kind: "answer", result: { kind: "error", error: schema } }
      unanswered.set(key, at + GATEWAY_RECEIPT_RETENTION_MS)
      onUnexpected?.(error)
      return {
        kind: "answer",
        result: failure(
          "internal_error",
          "The gateway store could not record the call; nothing ran.",
          "Retry the call; if it keeps failing, check the gateway store.",
        ),
      }
    } finally {
      // The slot passes to the key's recovery entry when the failure left one; otherwise it is free again.
      releaseAdmitting(key)
    }
    // The store committed this key's reservation for a call whose reply was lost, so nothing ran under it: the call resumes
    // as the reservation it found, a recovery keeping its first cause (#14623 review round 2 H1).
    if (admission.kind === "in_progress" && recoverable(key, at) && !running.has(key) && !unsettled.has(key))
      admission =
        admission.recovery === undefined
          ? { kind: "accepted", expires_at: admission.expires_at }
          : { kind: "retry", error_note: admission.recovery.error_note, expires_at: admission.expires_at }
    unanswered.delete(key)
    if (admission.kind === "replay") {
      const result = currentResult(admission.result as ThreadToolResult)
      const replayed =
        scope.operation === "thread_create" && result.kind === "ok" ? { ...result, deduplicated: true } : result
      return { kind: "answer", result: explicit ? withReceiptExpiry(replayed, admission.expires_at) : replayed }
    }
    if (admission.kind === "conflict")
      return {
        kind: "answer",
        result: failure(
          "idempotency_conflict",
          "The idempotency key was already used with different arguments.",
          "Retry with a new idempotency_key.",
        ),
      }
    if (admission.kind === "in_progress") {
      const note = unsettled.get(key)
      return {
        kind: "answer",
        result:
          note !== undefined
            ? failure(
                "idempotency_uncertain",
                "The earlier operation may have been delivered.",
                "Read the target transcript before deciding whether to retry.",
                { error_note: note },
              )
            : failure(
                "idempotency_in_progress",
                "The same operation is already in progress.",
                "Wait for the earlier call to settle, then retry.",
              ),
      }
    }
    // #14060: a call that failed after it may have acted recovers by running again; the call itself refuses unless it finds
    // what the first run did. The store reserved the receipt for this retry alone (#14623 H1).
    if (admission.kind === "uncertain") return { kind: "answer", result: uncertainFailure(admission.error_note) }
    running.add(key)
    return admission.kind === "retry"
      ? { kind: "run", retrying: { error_note: admission.error_note }, expires_at: admission.expires_at }
      : { kind: "run", expires_at: admission.expires_at }
  }

  /** The call ran and answered `result`; a call that may have acted without an answer stays uncertain under its note. */
  async function settle(
    scope: ReceiptScope,
    result: ThreadToolResult,
    retrying: { readonly error_note: string | null } | undefined,
  ): Promise<void> {
    // A call that may have acted (its reply was lost) has no answer yet: its receipt stays uncertain, so a retry under the
    // key runs it again, which finds what it did or answers uncertain again (#14060). The note keeps the first uncertain
    // answer's cause (#14569); a retry that fails in any way has not settled what the first run did, so its receipt stays
    // uncertain under that same note and its error is never replayed as final.
    const undecided =
      RETRIES_UNCERTAIN.has(scope.operation) &&
      result.kind === "error" &&
      (result.error.code === "idempotency_uncertain" || retrying !== undefined)
        ? (retrying?.error_note ?? uncertainNote(result.error))
        : undefined
    await store
      .toolReceiptSettle({
        ...scope,
        now: now(),
        ...(undecided === undefined ? { result } : { error_note: undecided }),
      })
      .then(
        (settled) => {
          if (!settled) unrecorded(scope, "the call ran")(new Error("this call no longer held its receipt"))
        },
        unrecorded(scope, "the call ran"),
      )
    running.delete(keyOf(scope))
  }

  /** The call threw after it was admitted: it may have acted, so its receipt records the failure as uncertain. */
  async function fail(scope: ReceiptScope, error: unknown): Promise<void> {
    const note = failureNote(error)
    await store
      .toolReceiptSettle({ ...scope, now: now(), error_note: note })
      .catch(unrecorded(scope, `the call failed (${note})`))
    running.delete(keyOf(scope))
  }

  return { admit, settle, fail, dispose: () => unanswered.clear() }
}

export type Receipts = ReturnType<typeof createReceipts>
