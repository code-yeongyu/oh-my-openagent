import { createHash, randomUUID } from "node:crypto"

import { resolveTarget, type ThreadAddressEntry } from "../addressing"
import { threadToolFailure, type ThreadErrorCode, type ThreadToolFailure } from "../errors"
import type { EndpointLiveness, GatewayEndpointPort, GatewayEndpointRef } from "./adapter"
import { TARGET_MAX_BYTES } from "./constants"
import { decideDelivery } from "./decision"
import { senderFacts } from "./envelope"
import { resultFromRow } from "./result"
import { resolveProvenance } from "./provenance-resolver"
import type { GatewayStore } from "./store"
import type { ExternalAuthor, GatewayDeliveryMode, GatewayDeliveryResult, GatewaySender, Provenance } from "./types"

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
  /** The highest chain hop an input of the caller's current run arrived with from another device (K8): the row continues it. */
  readonly inbound_hop?: number
}

export type GatewayEngine = {
  readonly deliver: (request: GatewayDeliverRequest) => Promise<GatewayDeliveryResult>
}

export type GatewayEngineOptions = {
  /** Sender-owned context, kept outside every delivery/tool request. */
  readonly senderProvenance?: () => Promise<Provenance>
  readonly store: Pick<GatewayStore, "now" | "enqueue" | "completeReceipt" | "deliveryView" | "abandonReceipt">
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
  loop_detected: "A session cannot message itself through the gateway; address another thread.",
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

function argsHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** The arguments a delivery receipt is keyed by: a retry with the same ones replays, different ones conflict. */
export function deliveryArgsHash(fields: {
  readonly target: string
  readonly text: string
  readonly mode: GatewayDeliveryMode
  readonly expected_turn_id: number | null
  readonly binding: { readonly binding_id: string; readonly revision: number } | null
  readonly author: ExternalAuthor | undefined
}): string {
  return argsHash({ target: fields.target, text: fields.text, mode: fields.mode, expected_turn_id: fields.expected_turn_id, binding: fields.binding, author: fields.author })
}

/**
 * Sender half of a delivery: resolve, one `BEGIN IMMEDIATE` transaction that writes the row, its
 * receipt, causal edge, budgets and the target's inbox marker, then a best-effort `wake` of a
 * routable endpoint. The result is read back from the target's row, which only the target's own
 * drain moves out of `queued`; an unreachable target answers `queued_offline`.
 */
export function createGatewayEngine(options: GatewayEngineOptions): GatewayEngine {
  const store = options.store
  const now = options.now ?? store.now

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
    const facts = senderFacts(request.sender, await (options.senderProvenance?.() ?? resolveProvenance({ cwd: process.cwd() })))
    const deliveryId = randomUUID()
    const idempotencyKey = request.idempotency_key ?? `auto:${deliveryId}`
    const outcome = await store.enqueue({
      provenance: facts.provenance,
      now: now(),
      delivery_id: deliveryId,
      target_durable_id: target.durable_id,
      sender_principal: facts.principal,
      rate_principal: facts.rate_principal,
      sender_node: facts.node,
      sender_turn: facts.turn,
      cause_delivery_id: facts.cause,
      ...(request.inbound_hop === undefined ? {} : { inbound_hop: request.inbound_hop }),
      claimed_root_id: request.root_id ?? null,
      origin: facts.origin(deliveryId),
      actor: facts.actor,
      body: request.text,
      mode,
      expected_turn_id: request.expected_turn_id ?? null,
      binding: facts.binding,
      receipt: {
        idempotency_key: idempotencyKey,
        args_hash: deliveryArgsHash({ target: target.durable_id, text: request.text, mode, expected_turn_id: request.expected_turn_id ?? null, binding: facts.binding, author: request.sender.kind === "external" ? request.sender.origin.author : undefined }),
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
      let reply: Awaited<ReturnType<GatewayEndpointPort["wake"]>> | undefined
      try {
        reply = await options.endpoints.wake(endpoint, [deliveryId])
      } catch {
        reply = undefined
      }
      const view = await store.deliveryView(deliveryId)
      if (view === null) throw new Error(`delivery ${deliveryId} vanished after commit`)
      // A live drain pass that finds a queued row always reports one (admitted, refused or held), so a
      // reply naming nothing while this row is still queued means no drain ran: the session has no
      // registered control endpoint, and nothing starts it before the session's next run (#12486).
      const drained = reply !== undefined && reply.unroutable === undefined && (view.row.state !== "queued" || (reply.admitted ?? []).length > 0)
      return await settle(resultFromRow(view.row, view.queue_position, endpoint.kind, false, !drained))
    } catch (error) {
      await store.abandonReceipt({ now: now(), principal: facts.principal, idempotency_key: idempotencyKey, error_note: error instanceof Error ? error.message : String(error) }).catch(() => false)
      throw error
    }
  }

  return { deliver }
}
