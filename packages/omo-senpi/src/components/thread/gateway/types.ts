import type { ThreadErrorCode, ThreadToolFailure } from "../errors"

export type GatewayDeliveryMode = "auto" | "steer" | "follow_up"

export type DeliveryState = "queued" | "admitting" | "admitted" | "applied" | "refused" | "uncertain"

export type EffectiveLane = "steer" | "follow_up"

export type RefusalReason = "not_steerable" | "turn_conflict" | "expired" | "binding_closed"

export type ProcessIdentity = {
  readonly pid: number
  readonly process_start_time: string | null
  readonly instance_id: string
}

export type ExternalOrigin = {
  readonly platform: string
  readonly account_id: string
  readonly chat_id: string
  readonly thread_id: string
  readonly message_id: string
}

export type EnvelopeOrigin = { readonly session: string } | { readonly external: ExternalOrigin }

export type DeliveryEnvelope = {
  readonly origin: EnvelopeOrigin
  readonly actor: string
  readonly via: readonly string[]
  readonly root_id: string
  readonly hop: number
  readonly delivery_id: string
}

export type DeliveryRow = {
  readonly delivery_id: string
  readonly target_durable_id: string
  readonly seq: number
  readonly sender: string
  readonly sender_turn: string | null
  readonly envelope: DeliveryEnvelope
  readonly body: string
  readonly bytes: number
  readonly mode_requested: GatewayDeliveryMode
  readonly mode_effective: EffectiveLane | null
  readonly expected_turn_id: number | null
  readonly state: DeliveryState
  readonly reason: string | null
  readonly admitted_by: ProcessIdentity | null
  readonly claimed_at: number | null
  readonly attempt: number
  readonly admission_kind: string | null
  readonly turn_epoch: number | null
  readonly root_id: string
  readonly hop: number
  readonly created_at: number
  readonly updated_at: number
  readonly expires_at: number
  readonly binding_id: string | null
  readonly binding_revision: number | null
}

/**
 * Who is sending. Every kind maps to one receipt/budget principal and one causal-graph node:
 * a session is `session:<durable id>`, the CLI is `cli:<uid>`, a connector is `binding:<id>`.
 * `turn_id` and `cause_delivery_id` come from the sender's runtime context, never from a model.
 */
export type GatewaySender =
  | {
      readonly kind: "session"
      readonly durable_id: string
      readonly name?: string
      readonly turn_id?: string
      readonly cause_delivery_id?: string
    }
  | { readonly kind: "cli"; readonly uid: number; readonly user: string }
  | {
      readonly kind: "external"
      readonly origin: ExternalOrigin
      readonly binding_id: string
      readonly binding_revision: number
    }

export type EnqueueRequest = {
  readonly now: number
  readonly delivery_id: string
  readonly target_durable_id: string
  readonly sender_principal: string
  readonly sender_node: string
  readonly sender_turn: string | null
  readonly cause_delivery_id: string | null
  readonly claimed_root_id: string | null
  readonly origin: EnvelopeOrigin
  readonly actor: string
  readonly body: string
  readonly mode: GatewayDeliveryMode
  readonly expected_turn_id: number | null
  readonly binding: { readonly binding_id: string; readonly revision: number } | null
  readonly receipt: { readonly idempotency_key: string; readonly args_hash: string }
  readonly endpoint_kind: "rpc_host" | "tui" | null
}

export type StoreRefusal = {
  readonly kind: "refused"
  readonly code: ThreadErrorCode
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

export type EnqueueOutcome =
  | { readonly kind: "inserted"; readonly row: DeliveryRow; readonly queue_position: number }
  | { readonly kind: "replay"; readonly result: unknown }
  | StoreRefusal
  | { readonly kind: "busy" }

export type AdmissionLedger = {
  readonly pending: readonly string[]
  readonly emitted: readonly string[]
}

export type ReconcileRequest = {
  readonly now: number
  readonly target_durable_id: string
  readonly self: ProcessIdentity
  readonly ledger: AdmissionLedger
  readonly session_path: string | null
}

export type ReconcileOutcome = {
  readonly queued: readonly DeliveryRow[]
  readonly transitions: readonly { readonly delivery_id: string; readonly from: DeliveryState; readonly to: DeliveryState }[]
  readonly dual_runtime: readonly string[]
}

export type ClaimRequest = {
  readonly now: number
  readonly delivery_id: string
  readonly self: ProcessIdentity
  readonly lane: EffectiveLane
}

export type ClaimOutcome = { readonly kind: "claimed"; readonly row: DeliveryRow } | { readonly kind: "lost"; readonly state: DeliveryState | null }

export type OutcomeRecord =
  | { readonly kind: "admitted"; readonly admission_kind: string; readonly turn_epoch: number }
  | { readonly kind: "applied"; readonly admission_kind: string; readonly turn_epoch: number }
  | { readonly kind: "requeue" }
  | { readonly kind: "refused"; readonly reason: RefusalReason }

export type RecordOutcomeRequest = {
  readonly now: number
  readonly delivery_id: string
  readonly self: ProcessIdentity
  readonly outcome: OutcomeRecord
}

export type GatewayDeliveryDelivery =
  | { readonly kind: "started" | "steered"; readonly turn_id: string }
  | { readonly kind: "queued" | "queued_offline"; readonly queue_position: number }

export type GatewayDeliverySuccess = {
  readonly kind: "ok"
  readonly thread_id: string
  readonly delivery_id: string
  readonly message_seq: number
  readonly delivery: GatewayDeliveryDelivery
  readonly effective_mode: GatewayDeliveryMode | EffectiveLane
  readonly endpoint_kind: "rpc_host" | "tui" | null
  readonly deduplicated: boolean
}

export type GatewayDeliveryResult = GatewayDeliverySuccess | { readonly kind: "error"; readonly error: ThreadToolFailure }

export type GatewayStoreEvent =
  | { readonly kind: "busy"; readonly op: string }
  | { readonly kind: "paused"; readonly hook: string }
  | { readonly kind: "barrier"; readonly op: string }
  | { readonly kind: "legacy_mailbox_invalid"; readonly directory: string; readonly error: string }

export type GatewayTestHookAction = "pause" | "sigkill" | "throw"

export type GatewayStoreTestHooks = {
  readonly beforeDbCommit?: GatewayTestHookAction
  readonly afterDbCommit?: GatewayTestHookAction
  readonly announceBarrier?: boolean
}

export type GatewayStoreConfig = {
  readonly agent_dir: string
  readonly busy_timeout_ms: number
  readonly instance_id: string
  readonly legacy_mailbox_directories: readonly string[]
  readonly test_hooks: GatewayStoreTestHooks
}

export type GatewayStoreStats = {
  readonly writes: number
  readonly marker_unlinks: number
  readonly transactions: number
}
