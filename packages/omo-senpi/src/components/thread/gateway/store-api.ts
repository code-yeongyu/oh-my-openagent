import type { BindingRecord, CompletionOutcome, OutboxRow, RelayOutcome } from "./bindings"
import type { ExtensionFacade } from "./store-extension-facade"
import type {
  AnswerClaim,
  AnswerClaimRef,
  AnswerDelivered,
  BindOpRequest,
  PriorAnswer,
  BindingsFilter,
  CasRequest,
  ReportOpRequest,
  ReportOpResult,
  ToolReceiptBegin,
} from "./store-relay-ops"
import type { ObserveModelRequest, ObserveModelResult, PendingChoice, SessionModelRecord, ThreadModel } from "./session-models"
import type { DeliveryReceipt } from "./store-ops"
import type { ClearEndpointRequest, RegisterIncarnationRequest, SessionOwner } from "./store-ownership"
import type {
  ClaimOutcome,
  ClaimRequest,
  DeliveryRow,
  EnqueueOutcome,
  EnqueueRequest,
  ExternalAuthor,
  GatewayStoreEvent,
  GatewayStoreStats,
  ProcessIdentity,
  ReconcileOutcome,
  ReconcileRequest,
  RecordOutcomeRequest,
  RefusalReason,
} from "./types"

/** The gateway store facade's API (`createGatewayStore` in `store.ts`). */
export type DeliveryView = { readonly row: DeliveryRow; readonly queue_position: number }

export type ReceiptScope = { readonly principal: string; readonly operation: string; readonly idempotency_key: string }

export type OutboxPage = { readonly binding_id: string; readonly revision: number; readonly status: BindingRecord["status"]; readonly rows: readonly OutboxRow[]; readonly next_cursor: number; readonly acked_cursor: number }

/** Relay results carry `deduplicated`: true when an idempotency key replayed an earlier success. */
export type Deduplicated = { readonly deduplicated?: boolean }

export type GatewayStore = ExtensionFacade & {
  /** The store's busy timeout: the delay before a caller re-arms an operation that failed with a lock-wait error. */
  readonly busyTimeoutMs: number
  /** The clock this store's rows are stamped and expired against; drains, engines and relays built on the store default to it. */
  readonly now: () => number
  readonly identity: () => Promise<ProcessIdentity>
  readonly enqueue: (request: EnqueueRequest) => Promise<EnqueueOutcome>
  readonly reconcile: (request: ReconcileRequest) => Promise<ReconcileOutcome>
  readonly claim: (request: ClaimRequest) => Promise<ClaimOutcome>
  readonly recordOutcome: (request: RecordOutcomeRequest) => Promise<ClaimOutcome>
  readonly refuseQueued: (request: { readonly now: number; readonly delivery_id: string; readonly reason: RefusalReason }) => Promise<boolean>
  readonly completeReceipt: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly result: unknown }) => Promise<boolean>
  readonly abandonReceipt: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly error_note: string }) => Promise<boolean>
  readonly deliveryView: (deliveryId: string) => Promise<DeliveryView | null>
  /** A completed delivery receipt's stored result and the row facts its arguments were hashed with; a plain read. */
  readonly deliveryReceipt: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string }) => Promise<DeliveryReceipt | null>
  readonly recoverDelivery: (request: { readonly now: number; readonly principal: string; readonly idempotency_key: string; readonly args_hash: string }) => Promise<EnqueueOutcome | null>
  readonly list: (filter?: { readonly target_durable_id?: string; readonly root_id?: string }) => Promise<readonly DeliveryRow[]>
  readonly isReferenced: (durableId: string) => Promise<boolean>
  readonly journalMode: () => Promise<string>
  readonly stats: () => Promise<GatewayStoreStats>
  readonly legacyMigrated: () => Promise<number>
  readonly toolReceiptBegin: (request: ReceiptScope & { readonly now: number; readonly args_hash: string }) => Promise<ToolReceiptBegin>
  readonly toolReceiptSettle: (request: ReceiptScope & { readonly now: number } & ({ readonly result: unknown } | { readonly error_note: string })) => Promise<boolean>
  readonly bind: (request: BindOpRequest) => Promise<RelayOutcome<{ readonly binding: BindingRecord } & Deduplicated>>
  readonly unbind: (request: CasRequest) => Promise<RelayOutcome<{ readonly binding: BindingRecord; readonly already_closed: boolean; readonly in_flight: readonly string[] } & Deduplicated>>
  readonly rebind: (request: CasRequest & { readonly session_durable_id: string }) => Promise<RelayOutcome<{ readonly binding: BindingRecord; readonly closed: readonly string[] } & Deduplicated>>
  readonly listBindings: (request: { readonly now: number; readonly filter: BindingsFilter; readonly cursor?: string; readonly limit?: number }) => Promise<RelayOutcome<{ readonly bindings: readonly BindingRecord[]; readonly next_cursor: string | null }>>
  readonly bindingView: (request: { readonly now: number; readonly binding_id: string }) => Promise<BindingRecord | null>
  readonly registerIncarnation: (request: RegisterIncarnationRequest) => Promise<void>
  readonly clearEndpoint: (request: ClearEndpointRequest) => Promise<void>
  readonly sessionOwner: (durableId: string) => Promise<SessionOwner | null>
  readonly report: (request: ReportOpRequest) => Promise<RelayOutcome<ReportOpResult & Deduplicated>>
  readonly emitCompletions: (request: { readonly now: number; readonly session_durable_id: string; readonly outcome: CompletionOutcome; readonly through_arm_seq?: number }) => Promise<readonly { readonly binding_id: string; readonly cursor: number }[]>
  /** Completion arms waiting for the session's settle; a plain read that takes no write lock. */
  readonly pendingCompletionArms: (durableId: string) => Promise<number>
  /** The sequence number of the newest completion arm waiting for the session's settle, null when none waits; a plain read that takes no write lock. */
  readonly latestCompletionArm: (durableId: string) => Promise<number | null>
  readonly readOutbox: (request: { readonly now: number; readonly binding_id: string; readonly after_cursor?: number; readonly limit?: number }) => Promise<RelayOutcome<OutboxPage>>
  readonly ackOutbox: (request: { readonly now: number; readonly binding_id: string; readonly cursor: number; readonly provider_message_id?: string }) => Promise<RelayOutcome<{ readonly binding_id: string; readonly acked_cursor: number; readonly changed: boolean }>>
  readonly claimAnswer: (request: { readonly now: number; readonly binding_id: string; readonly reply_token: string; readonly answer: string; readonly answered_by?: ExternalAuthor | null }) => Promise<RelayOutcome<AnswerClaim>>
  readonly releaseAnswer: (request: AnswerClaimRef) => Promise<boolean>
  readonly confirmAnswer: (request: AnswerDelivered) => Promise<boolean>
  readonly markPriorDelivered: (request: AnswerClaimRef & { readonly prior: PriorAnswer }) => Promise<boolean>
  /** #9425: the gateway's own model choice for a session it created or re-modelled. */
  readonly recordSessionModel: (request: { readonly now: number; readonly durable_id: string; readonly model: ThreadModel }) => Promise<ThreadModel>
  /** Compare-and-swap variant (#9429 B2): writes only while the record is still at `expect_revision` (null: no record); `record` is the record after the call. */
  readonly recordSessionModelIfCurrent: (request: { readonly now: number; readonly durable_id: string; readonly expect_revision: number | null; readonly model: ThreadModel; readonly pending?: PendingChoice }) => Promise<{ readonly applied: boolean; readonly record: SessionModelRecord | null }>
  /** A new thinking level for a session with a model record; false when there is none. */
  readonly updateSessionThinking: (request: { readonly now: number; readonly durable_id: string; readonly thinking_level: string }) => Promise<boolean>
  /** A set-model's choice, noted before it asks the engine and waiting on the record until the switch lands (#9429); `previous` is the choice it replaced. */
  readonly recordPendingSessionModel: (request: PendingChoice & { readonly now: number; readonly durable_id: string }) => Promise<{ readonly recorded: boolean; readonly previous: PendingChoice | null }>
  /** Replaces that choice with `next` (null clears it) only while the record still holds `expect`. */
  readonly replacePendingSessionModel: (request: { readonly durable_id: string; readonly expect: PendingChoice; readonly next: PendingChoice | null }) => Promise<boolean>
  /** The session's own `model_select`: keeps its record true and writes a fallback switch's milestone rows. */
  readonly observeModelSelect: (request: ObserveModelRequest) => Promise<ObserveModelResult>
  /** The model records of these sessions that exist, keyed by durable id; a plain read that takes no write lock. */
  readonly sessionModels: (durableIds: readonly string[]) => Promise<Readonly<Record<string, ThreadModel>>>
  /** One session's model record with its revision, null when it has none; a plain read that takes no write lock. */
  readonly sessionModelRecord: (durableId: string) => Promise<SessionModelRecord | null>
  /** The session closed a relayed question itself (answered locally, timed out, cancelled); the questions closed. */
  readonly closeQuestion: (request: { readonly now: number; readonly session_durable_id: string; readonly ui_request_id: string }) => Promise<number>
  readonly onEvent: (listener: (event: GatewayStoreEvent) => void) => () => void
  /** Releases a `pause` test hook. */
  readonly resume: (hook: "beforeDbCommit" | "afterDbCommit") => void
  readonly dispose: () => Promise<void>
}
