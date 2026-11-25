import type { GatewayStore } from "../../../packages/omo-senpi/src/components/thread/gateway/store"
import type { StoreExtensionResult } from "../../../packages/omo-senpi/src/components/thread/gateway/store-extensions"
import type { DeliveryRow, EnqueueRequest } from "../../../packages/omo-senpi/src/components/thread/gateway/types"
import type { Recorder } from "./recorder"

// The gateway store port over one recorder. Only the members the P1b cores reach are faked: the extension channel
// (store.register_extension {name, migrations: <count>, wakeDir?, sessionCallable?}, store.extension_call {name, op,
// args}) and the lifetime members. Any other member throws, naming itself, so a core that starts using one shows up as a
// failed run instead of a silent pass. A stated `{ code }` is the store's refusal with that code.

const answer = (result: unknown, fallback: unknown): StoreExtensionResult<never> => {
  const code = Reflect.get(Object(result), "code")
  if (typeof code === "string") return { kind: "refused", code: code as never, message: `fake store refused: ${code}` }
  return { kind: "ok", value: (result ?? fallback) as never }
}

// The receipt book every keyed thread call admits through (T1b, thread/control/receipts.ts): kept in memory with the
// real store's answers (accepted, replay, conflict, in_progress, uncertain) and never recorded, because bookkeeping is no
// scenario's effect; a repeated key then acts once, as on the real store.
type Receipt = {
  readonly hash: string
  status: "prepared" | "completed" | "uncertain"
  result?: unknown
  note?: string
}

function receiptBook(
  now: () => number,
): Pick<GatewayStore, "toolReceiptBegin" | "toolReceiptSettle" | "toolReceiptRelease"> {
  const held = new Map<string, Receipt>()
  const keyOf = (scope: { readonly principal: string; readonly operation: string; readonly idempotency_key: string }) =>
    `${scope.principal}\u0000${scope.operation}\u0000${scope.idempotency_key}`
  const expires_at = () => now() + 30 * 24 * 60 * 60 * 1000
  return {
    toolReceiptBegin: async (request) => {
      const known = held.get(keyOf(request))
      if (known === undefined) {
        held.set(keyOf(request), { hash: request.args_hash, status: "prepared" })
        return { kind: "accepted", expires_at: expires_at() }
      }
      if (known.hash !== request.args_hash) return { kind: "conflict" }
      if (known.status === "completed") return { kind: "replay", result: known.result, expires_at: expires_at() }
      if (known.status === "prepared") return { kind: "in_progress", expires_at: expires_at() }
      return { kind: "uncertain", error_note: known.note ?? null }
    },
    toolReceiptSettle: async (request) => {
      const known = held.get(keyOf(request))
      if (known === undefined) return false
      if ("result" in request) Object.assign(known, { status: "completed", result: request.result })
      else Object.assign(known, { status: "uncertain", note: request.error_note })
      return true
    },
    toolReceiptRelease: async (scope) => held.delete(keyOf(scope)),
  }
}

// The deliveries a send writes (gateway/engine.ts), kept in memory with the real store's answers: a key used before
// replays its completed result, or answers idempotency_conflict when its arguments differ. Only the insert is an effect
// (store.insert_delivery {thread, mode, expected_turn_id?, collapse_key?}); a stated `{ code }` refuses it and a stated
// `{ collapsed: true }` is absorbed by the sender's earlier delivery under its collapse key (no wake follows). The host's
// wake (fakes/host.ts) admits a row in its lane, so the store and the host share one ledger.
export type DeliveryLedger = {
  readonly store: Pick<
    GatewayStore,
    "enqueue" | "completeReceipt" | "abandonReceipt" | "deliveryView" | "receiptOutcome" | "sessionOwner"
  >
  readonly row: (deliveryId: string) => DeliveryRow | undefined
  readonly admit: (deliveryId: string, lane: "start" | "steer" | "follow_up") => void
}

export function deliveryLedger(recorder: Recorder): DeliveryLedger {
  const rows = new Map<string, DeliveryRow>()
  const receipts = new Map<string, { readonly hash: string; readonly delivery_id: string; result?: unknown }>()
  const keyOf = (principal: string, key: string) => `${principal}\u0000${key}`
  const insert = (request: EnqueueRequest): DeliveryRow => ({
    delivery_id: request.delivery_id,
    target_durable_id: request.target_durable_id,
    seq: rows.size + 1,
    sender: request.sender_principal,
    sender_turn: request.sender_turn,
    envelope: { origin: request.origin, actor: request.actor } as never,
    body: request.body,
    bytes: Buffer.byteLength(request.body),
    mode_requested: request.mode,
    mode_effective: null,
    expected_turn_id: request.expected_turn_id,
    state: "queued",
    reason: null,
    admitted_by: null,
    claimed_at: null,
    attempt: 0,
    admission_kind: null,
    wait_kind: null,
    turn_epoch: null,
    root_id: request.claimed_root_id ?? `root-${request.delivery_id}`,
    hop: 1,
    created_at: request.now,
    updated_at: request.now,
    expires_at: request.now + 24 * 60 * 60 * 1000,
    collapse_key: request.collapse_key ?? null,
  })
  return {
    store: {
      enqueue: async (request) => {
        const known = receipts.get(keyOf(request.sender_principal, request.receipt.idempotency_key))
        if (known !== undefined) {
          if (known.hash !== request.receipt.args_hash)
            return {
              kind: "refused",
              code: "idempotency_conflict",
              message: "The idempotency key was already used with different arguments.",
            }
          if (known.result !== undefined) return { kind: "replay", result: known.result }
          return {
            kind: "refused",
            code: "idempotency_in_progress",
            message: "The same delivery is already in progress.",
          }
        }
        const { result } = recorder.record("store", "insert_delivery", {
          thread: request.target_durable_id,
          mode: request.mode,
          ...(request.expected_turn_id === null ? {} : { expected_turn_id: String(request.expected_turn_id) }),
          ...(request.collapse_key === undefined ? {} : { collapse_key: request.collapse_key }),
        })
        const code = Reflect.get(Object(result), "code")
        if (typeof code === "string")
          return { kind: "refused", code: code as never, message: `fake store refused: ${code}` }
        const row = insert(request)
        rows.set(row.delivery_id, row)
        receipts.set(keyOf(request.sender_principal, request.receipt.idempotency_key), {
          hash: request.receipt.args_hash,
          delivery_id: row.delivery_id,
        })
        if (Reflect.get(Object(result), "collapsed") === true) return { kind: "collapsed", row, queue_position: 1 }
        return { kind: "inserted", row, queue_position: 1 }
      },
      completeReceipt: async (request) => {
        const known = receipts.get(keyOf(request.principal, request.idempotency_key))
        if (known === undefined) return false
        known.result = request.result
        return true
      },
      abandonReceipt: async (request) => receipts.delete(keyOf(request.principal, request.idempotency_key)),
      deliveryView: async (deliveryId) => {
        const row = rows.get(deliveryId)
        return row === undefined ? null : { row, queue_position: 1 }
      },
      receiptOutcome: async (request) => {
        const row = rows.get(request.delivery_id)
        return row === undefined
          ? { kind: "outcome_unavailable" }
          : { kind: row.state === "queued" ? "pending" : "admitted" }
      },
      sessionOwner: async () => null,
    },
    row: (deliveryId) => rows.get(deliveryId),
    admit: (deliveryId, lane) => {
      const row = rows.get(deliveryId)
      if (row === undefined) return
      rows.set(deliveryId, {
        ...row,
        state: "admitted",
        mode_effective: lane,
        admission_kind: lane === "start" ? "started" : lane === "steer" ? "steered" : "queued",
        turn_epoch: row.expected_turn_id ?? 1,
      })
    },
  }
}

export function storePort(recorder: Recorder, now: () => number, deliveries?: DeliveryLedger): GatewayStore {
  const faked: Partial<GatewayStore> = {
    busyTimeoutMs: 0,
    now,
    ...receiptBook(now),
    ...deliveries?.store,
    registerStoreExtension: async (extension) => {
      const { result } = recorder.record("store", "register_extension", {
        name: extension.name,
        migrations: extension.migrations.length,
        ...(extension.wakeDir === undefined ? {} : { wakeDir: extension.wakeDir }),
        ...(extension.sessionCallable === undefined ? {} : { sessionCallable: extension.sessionCallable }),
      })
      return answer(result, { version: 1 })
    },
    extensionCall: async (name, op, args) => {
      const { result } = recorder.record("store", "extension_call", { name, op, args: args as never })
      return answer(result, null)
    },
    dispose: async () => undefined,
  }
  return new Proxy(faked as GatewayStore, {
    get: (target, key, receiver) => {
      if (Reflect.has(target, key) || typeof key === "symbol" || key === "then")
        return Reflect.get(target, key, receiver)
      return () => {
        throw new Error(`fake store: ${key} is not faked; a scenario that reaches it needs this fake extended`)
      }
    },
  })
}
