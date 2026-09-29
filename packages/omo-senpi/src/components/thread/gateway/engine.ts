import { createHash, randomUUID } from "node:crypto"

import { resolveTarget, type ThreadAddressEntry } from "../addressing"
import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "../errors"
import type { EndpointLiveness, GatewayEndpointPort, GatewayEndpointRef } from "./adapter"
import { TARGET_MAX_BYTES } from "./constants"
import { decideDelivery } from "./decision"
import { resultFromRow } from "./result"
import type { GatewayStore } from "./store"
import type { EnvelopeOrigin, GatewayDeliveryMode, GatewayDeliveryResult, GatewaySender } from "./types"

export type GatewayTarget = {
  readonly durable_id: string
  readonly endpoint: GatewayEndpointRef | null
  readonly liveness: EndpointLiveness
}

export type GatewayResolution = { readonly kind: "ok"; readonly target: GatewayTarget } | { readonly kind: "error"; readonly error: ThreadToolFailure }

export type GatewayResolve = (address: string, options: { readonly all_scope?: boolean }) => Promise<GatewayResolution>

export type GatewayAddressEntry = ThreadAddressEntry & {
  readonly endpoint: GatewayEndpointRef | null
  readonly liveness: EndpointLiveness
}

export type GatewayDeliverRequest = {
  readonly sender: GatewaySender
  readonly target: string
  readonly text: string
  readonly mode?: GatewayDeliveryMode
  readonly expected_turn_id?: number
  readonly all_scope?: boolean
  readonly idempotency_key?: string
  readonly root_id?: string
}

export type GatewayEngine = {
  readonly deliver: (request: GatewayDeliverRequest) => Promise<GatewayDeliveryResult>
}

export type GatewayEngineOptions = {
  readonly store: GatewayStore
  readonly endpoints: GatewayEndpointPort
  readonly resolve: GatewayResolve
  readonly now?: () => number
}

export function resolveFromEntries(entries: () => readonly GatewayAddressEntry[] | Promise<readonly GatewayAddressEntry[]>, callerWorkspaceRoot: () => string): GatewayResolve {
  return async (address, options) => {
    const known = await entries()
    const resolved = resolveTarget(known, address, { all_scope: options.all_scope, callerWorkspaceRoot: callerWorkspaceRoot() })
    if (resolved.kind !== "ok") {
      const details = resolved.candidates === undefined ? undefined : { candidates: resolved.candidates }
      return { kind: "error", error: threadToolFailure(resolved.code, resolved.message, resolved.next_action, details) }
    }
    const entry = resolved.entry as GatewayAddressEntry
    return { kind: "ok", target: { durable_id: entry.thread_id, endpoint: entry.endpoint, liveness: entry.liveness } }
  }
}

const NEXT_ACTION: Partial<Record<ThreadErrorCode, string>> = {
  loop_detected: "Stop relaying here: a direct reply to the session that messaged you is a cycle. That session reads your answer with thread_read; a bound external thread gets it through thread_report, and its questions come back through thread_answer.",
  overloaded: "Wait before sending to this session again.",
  queue_full: "Wait for the target to take its queued messages, then send again.",
  idempotency_conflict: "Retry with a new idempotency_key.",
  idempotency_in_progress: "Wait for the earlier call to settle, then retry.",
  idempotency_uncertain: "Read the target transcript before deciding whether to send again; the gateway never resends.",
  invalid_arguments: "Fix the arguments and send again.",
}

function fail(code: ThreadErrorCode, message: string, details?: Readonly<Record<string, unknown>>): GatewayDeliveryResult {
  return { kind: "error", error: threadToolFailure(code, message, NEXT_ACTION[code] ?? "Call thread_list and retry after checking the target.", details) }
}

type SenderFacts = {
  readonly principal: string
  readonly node: string
  readonly turn: string | null
  readonly cause: string | null
  readonly actor: string
  readonly origin: (deliveryId: string) => EnvelopeOrigin
  readonly binding: { readonly binding_id: string; readonly revision: number } | null
}

function senderFacts(sender: GatewaySender): SenderFacts {
  if (sender.kind === "session") {
    return {
      principal: `session:${sender.durable_id}`,
      node: sender.durable_id,
      turn: sender.turn_id ?? null,
      cause: sender.cause_delivery_id ?? null,
      actor: sender.name ?? sender.durable_id,
      origin: () => ({ session: sender.durable_id }),
      binding: null,
    }
  }
  if (sender.kind === "cli") {
    const principal = `cli:${sender.uid}`
    return {
      principal,
      node: principal,
      turn: null,
      cause: null,
      actor: sender.user,
      origin: (deliveryId) => ({ external: { platform: "cli", account_id: sender.user, chat_id: "@cli", thread_id: "@chat", message_id: deliveryId } }),
      binding: null,
    }
  }
  const principal = `binding:${sender.binding_id}`
  return {
    principal,
    node: principal,
    turn: null,
    cause: null,
    actor: sender.origin.account_id,
    origin: () => ({ external: sender.origin }),
    binding: { binding_id: sender.binding_id, revision: sender.binding_revision },
  }
}

function argsHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/**
 * Sender half of a delivery: resolve, one `BEGIN IMMEDIATE` transaction that writes the row, its
 * receipt, causal edge, budgets and the target's inbox marker, then a best-effort `wake` of a
 * routable endpoint. The result is read back from the target's row, which only the target's own
 * drain moves out of `queued`; an unreachable target answers `queued_offline`.
 */
export function createGatewayEngine(options: GatewayEngineOptions): GatewayEngine {
  const now = options.now ?? Date.now
  const store = options.store

  async function deliver(request: GatewayDeliverRequest): Promise<GatewayDeliveryResult> {
    const mode = request.mode ?? "auto"
    if (mode === "steer" && request.expected_turn_id === undefined) return fail("invalid_arguments", "A steer needs expected_turn_id (the target's current turn_epoch).")
    const bytes = Buffer.byteLength(request.text)
    if (bytes > TARGET_MAX_BYTES) return fail("message_too_large", `The message is ${bytes} bytes, above the ${TARGET_MAX_BYTES}-byte limit.`)
    const resolved = await options.resolve(request.target, { all_scope: request.all_scope })
    if (resolved.kind === "error") return resolved
    const target = resolved.target
    const endpoint = target.liveness === "routable" ? target.endpoint : null
    if (endpoint === null && decideDelivery("offline", mode, request.expected_turn_id ?? null, null).kind === "refuse") {
      return fail("turn_conflict", "The target has no live turn to steer.", { target: target.durable_id })
    }
    const facts = senderFacts(request.sender)
    const deliveryId = randomUUID()
    const idempotencyKey = request.idempotency_key ?? `auto:${deliveryId}`
    const outcome = await store.enqueue({
      now: now(),
      delivery_id: deliveryId,
      target_durable_id: target.durable_id,
      sender_principal: facts.principal,
      sender_node: facts.node,
      sender_turn: facts.turn,
      cause_delivery_id: facts.cause,
      claimed_root_id: request.root_id ?? null,
      origin: facts.origin(deliveryId),
      actor: facts.actor,
      body: request.text,
      mode,
      expected_turn_id: request.expected_turn_id ?? null,
      binding: facts.binding,
      receipt: {
        idempotency_key: idempotencyKey,
        args_hash: argsHash({ target: target.durable_id, text: request.text, mode, expected_turn_id: request.expected_turn_id ?? null, binding: facts.binding }),
      },
      endpoint_kind: endpoint?.kind ?? null,
    })
    if (outcome.kind === "busy") return fail("overloaded", "The gateway store is locked by a suspended writer; nothing was sent.", { budget: "store_lock" })
    if (outcome.kind === "refused") return fail(outcome.code, outcome.message, outcome.details)
    if (outcome.kind === "replay") {
      const replayed = outcome.result as GatewayDeliveryResult
      return replayed.kind === "ok" ? { ...replayed, deduplicated: true } : replayed
    }
    const settle = async (result: GatewayDeliveryResult): Promise<GatewayDeliveryResult> => {
      await store.completeReceipt({ now: now(), principal: facts.principal, idempotency_key: idempotencyKey, result })
      return result
    }
    try {
      if (endpoint === null) return await settle(resultFromRow(outcome.row, outcome.queue_position, null, false, true))
      let reached = true
      try {
        await options.endpoints.wake(endpoint, [deliveryId])
      } catch {
        reached = false
      }
      const view = await store.deliveryView(deliveryId)
      if (view === null) throw new Error(`delivery ${deliveryId} vanished after commit`)
      return await settle(resultFromRow(view.row, view.queue_position, endpoint.kind, false, !reached))
    } catch (error) {
      await store.abandonReceipt({ now: now(), principal: facts.principal, idempotency_key: idempotencyKey, error_note: error instanceof Error ? error.message : String(error) }).catch(() => false)
      throw error
    }
  }

  return { deliver }
}
