import { randomUUID } from "node:crypto"
import type { ThreadToolResult } from "../contracts"
import { threadToolFailure, type ThreadToolFailure } from "../errors"
import { hashArgs } from "../gateway/bindings"
import type { GatewayStore } from "../gateway/store"
import type { DeliveryOutcome, DeliveryTransport, OutboundDelivery } from "../gateway/transport"
import type { Provenance } from "../gateway/types"
import { UNKNOWN_CALLER } from "../tools/ports"
import { promptRemote } from "./lazy-ops"
import type { RemotePeer } from "./peer-text"
import type { RemoteThreadSurface } from "./ports"

export type RelayTransportOptions = {
  readonly remote: RemoteThreadSurface
  readonly store: Pick<GatewayStore, "now" | "toolReceiptBegin" | "toolReceiptSettle" | "deliveryView">
  readonly now?: () => number
  readonly senderProvenance: () => Promise<Provenance>
  readonly callerCause?: () => string | undefined
  readonly callerName?: () => string | undefined
}

type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }
const fail = (code: ThreadToolFailure["code"], message: string, next: string, details?: Readonly<Record<string, unknown>>): Failure => ({ kind: "error", error: threadToolFailure(code, message, next, details) })

/**
 * Other-device transport. A send to another device has no gateway row to carry its idempotency, so it keeps the same
 * promise through the tool receipt store: a retry under the same key replays the first answer (deduplicated) and sends
 * nothing. The sender is named the way a local delivery names it (gateway/engine.ts senderFacts), and the chain the
 * caller's run consumed continues (K8 / R8.c, #12852).
 */
export function createRelayTransport(options: RelayTransportOptions): DeliveryTransport {
  const { remote, store } = options
  const now = options.now ?? store.now
  const unsettled = new Map<string, string>()
  const receiptKey = (scope: { readonly principal: string; readonly operation: string; readonly idempotency_key: string }) => `${scope.principal}\u0000${scope.operation}\u0000${scope.idempotency_key}`

  async function peer(callerId: string): Promise<RemotePeer> {
    const cause = options.callerCause?.()
    const prior = cause === undefined ? undefined : (await store.deliveryView(cause))?.row
    const name = options.callerName?.()?.trim()
    const deliveryId = randomUUID()
    const provenance = await options.senderProvenance()
    return {
      session_id: callerId,
      ...(name === undefined || name === "" ? {} : { name }),
      provenance: name === undefined || name === "" ? provenance : { ...provenance, session: name },
      delivery_id: deliveryId,
      root_id: prior?.root_id ?? deliveryId,
      hop: (prior?.hop ?? 0) + 1,
    }
  }

  async function once(callerId: string, idempotencyKey: string, args: unknown, run: () => Promise<ThreadToolResult>): Promise<ThreadToolResult> {
    const scope = { principal: `session:${callerId}`, operation: "thread_send:remote", idempotency_key: idempotencyKey }
    const admission = await store.toolReceiptBegin({ ...scope, now: now(), args_hash: hashArgs(args) })
    if (admission.kind === "replay") { const first = admission.result as ThreadToolResult; return first.kind === "ok" && "deduplicated" in first ? { ...first, deduplicated: true } as ThreadToolResult : first }
    if (admission.kind === "conflict") return fail("idempotency_conflict", "The idempotency key was already used with different arguments.", "Retry with a new idempotency_key.")
    const note = unsettled.get(receiptKey(scope))
    if (admission.kind === "in_progress" && note !== undefined) return fail("idempotency_uncertain", "The earlier operation may have been delivered.", "Read the target transcript before deciding whether to retry.", { error_note: note })
    if (admission.kind === "in_progress") return fail("idempotency_in_progress", "The same operation is already in progress.", "Wait for the earlier call to settle, then retry.")
    if (admission.kind === "uncertain") return fail("idempotency_uncertain", "The earlier operation may have been delivered.", "Read the target transcript before deciding whether to retry.")
    const unrecorded = (what: string) => (settleError: unknown) => { unsettled.set(receiptKey(scope), `${what}, and its receipt could not be recorded: ${settleError instanceof Error ? settleError.message : String(settleError)}`) }
    let result: ThreadToolResult
    try {
      result = await run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await store.toolReceiptSettle({ ...scope, now: now(), error_note: message }).catch(unrecorded(`the send failed (${message})`))
      throw error
    }
    await store.toolReceiptSettle({ ...scope, now: now(), result }).catch(unrecorded("the send ran"))
    return result
  }

  return {
    deliver: async (delivery: OutboundDelivery): Promise<DeliveryOutcome> => {
      if (delivery.target.kind !== "remote") throw new Error("the relay transport delivers only to sessions on other devices")
      const row = delivery.target.row
      // Before a receipt is written, exactly where a local gateway send refuses an unknown caller.
      if (delivery.caller_id === UNKNOWN_CALLER) return fail("caller_context_missing", "A gateway send needs the calling session's durable id.", "Retry from a session that passes its execution context.")
      const request = { message: delivery.text, delivery: delivery.mode, ...(delivery.expected_turn_id === undefined ? {} : { expected_turn_id: delivery.expected_turn_id }) }
      const sent = await once(delivery.caller_id, delivery.idempotency_key, delivery.args, async () => await promptRemote(remote, row, request, { kind: "peer", ...await peer(delivery.caller_id) }))
      if (sent.kind !== "ok" || !("delivery" in sent)) return sent.kind === "ok" ? fail("internal_error", "The remote send answered without a delivery.", "Read the target thread before retrying.") : sent
      return { kind: "ok", thread_id: row.session_id, delivery: sent.delivery, deduplicated: sent.deduplicated, device: row.device }
    },
  }
}
