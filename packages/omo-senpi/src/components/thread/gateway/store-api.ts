import type { ExtensionFacade } from "./store-extension-facade"
import type { ToolReceiptBegin } from "./store-tool-receipts"
import type { IntakeMarkStore, SessionWaitStore } from "./session-wait-types"
import type { WokenSessionStore } from "./woken-types"
import type { ClearEndpointRequest, RegisterIncarnationRequest, SessionOwner } from "./store-ownership"
import type {
  ClaimOutcome,
  ClaimRequest,
  DeliveryRow,
  EnqueueOutcome,
  EnqueueRequest,
  GatewayStoreEvent,
  GatewayStoreStats,
  IntakeOutcome,
  IntakeRequest,
  ProcessIdentity,
  ReconcileOutcome,
  ReconcileRequest,
  RecordOutcomeRequest,
  RefusalReason,
} from "./types"

/** The gateway store facade's API (`createGatewayStore` in `store.ts`). */
export type DeliveryView = { readonly row: DeliveryRow; readonly queue_position: number }

export type ReceiptScope = { readonly principal: string; readonly operation: string; readonly idempotency_key: string }

export type GatewayStore = ExtensionFacade & {
  /** The store's busy timeout: the delay before a caller re-arms an operation that failed with a lock-wait error. */
  readonly busyTimeoutMs: number
  /** The clock this store's rows are stamped and expired against; drains, engines and relays built on the store default to it. */
  readonly now: () => number
  readonly identity: () => Promise<ProcessIdentity>
  readonly enqueue: (request: EnqueueRequest) => Promise<EnqueueOutcome>
  /** A record another device's service attested, for a session here that is not running (#13037); nothing calls it in production yet. */
  readonly intake: (request: IntakeRequest) => Promise<IntakeOutcome>
  /** The record of woken sessions (#13037 A3.1); nothing calls it in production yet. */
  readonly woken: WokenSessionStore
  /** A session's held or waiting state, read by the carrier, the sweep and the row answers (#13037 A2.6, A3.2.8). */
  readonly sessionWait: SessionWaitStore
  /** The newest queued command per (sender device, session), for the device service's hand-over mark (#13037). */
  readonly intakeMarks: IntakeMarkStore
  readonly reconcile: (request: ReconcileRequest) => Promise<ReconcileOutcome>
  readonly claim: (request: ClaimRequest) => Promise<ClaimOutcome>
  readonly recordOutcome: (request: RecordOutcomeRequest) => Promise<ClaimOutcome>
  readonly refuseQueued: (request: {
    readonly now: number
    readonly delivery_id: string
    readonly reason: RefusalReason
  }) => Promise<boolean>
  readonly completeReceipt: (request: {
    readonly now: number
    readonly principal: string
    readonly idempotency_key: string
    readonly result: unknown
  }) => Promise<boolean>
  readonly abandonReceipt: (request: {
    readonly now: number
    readonly principal: string
    readonly idempotency_key: string
    readonly error_note: string
  }) => Promise<boolean>
  readonly deliveryView: (deliveryId: string) => Promise<DeliveryView | null>
  readonly list: (filter?: {
    readonly target_durable_id?: string
    readonly root_id?: string
  }) => Promise<readonly DeliveryRow[]>
  readonly isReferenced: (durableId: string) => Promise<boolean>
  readonly journalMode: () => Promise<string>
  readonly stats: () => Promise<GatewayStoreStats>
  readonly legacyMigrated: () => Promise<number>
  readonly toolReceiptBegin: (
    request: ReceiptScope & { readonly now: number; readonly args_hash: string },
  ) => Promise<ToolReceiptBegin>
  readonly toolReceiptSettle: (
    request: ReceiptScope & { readonly now: number } & ({ readonly result: unknown } | { readonly error_note: string }),
  ) => Promise<boolean>
  /** Replaces a completed receipt's answer with the call's later final one (a held relayed steer refused `turn_conflict`); false when this instance settled no such receipt. */
  readonly toolReceiptRevise: (
    request: ReceiptScope & { readonly now: number; readonly result: unknown },
  ) => Promise<boolean>
  /** Drops this instance's `prepared` receipt for a call that wrote nothing, so the same key runs again; true when one was dropped. */
  readonly toolReceiptRelease: (request: ReceiptScope) => Promise<boolean>
  readonly registerIncarnation: (request: RegisterIncarnationRequest) => Promise<void>
  readonly clearEndpoint: (request: ClearEndpointRequest) => Promise<void>
  readonly sessionOwner: (durableId: string) => Promise<SessionOwner | null>
  readonly onEvent: (listener: (event: GatewayStoreEvent) => void) => () => void
  /** Releases a `pause` test hook. */
  readonly resume: (hook: "beforeDbCommit" | "afterDbCommit") => void
  readonly dispose: () => Promise<void>
}
