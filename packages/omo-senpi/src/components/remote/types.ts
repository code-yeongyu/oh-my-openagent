import type {
  AccountShowResult as DeviceAccountShowResult,
  CommandResult as DeviceCommandResult,
  CommandRpc,
  ControlAttachState,
  JsonObject as WireJsonObject,
  ReadPage as WireReadPage,
  SnapshotBody as WireSnapshotBody,
  Status,
} from "@oh-my-opencode/device-service-core"
import type { ExternalAuthor } from "../thread/gateway/types"
import type { RemoteCode } from "./codes"

// The types of the one remote module (design one-remote-module v8-core r2, section B1 and Appendix B, as confirmed).

// Appendix B names seven types without their source (verdict D-04). Each comes from the layer below, unchanged:

/** The human a connector authenticated: the thread gateway's `ExternalAuthor` (thread/gateway/types.ts). */
export type Author = ExternalAuthor
/** An attach's first state: the local API's `session.snapshot` body (device-service-core, local-api/protocol-events.ts). */
export type SnapshotBody = WireSnapshotBody
/** One engine RPC record, opaque here and classed by the receiving engine: the local API's `CommandRpc` (local-api/protocol.ts). */
export type EngineRecord = CommandRpc
/** How an engine record ended, with the engine's reply: the device service's `CommandResult` (device-service-core, remote-attach.ts). */
export type CommandResult = DeviceCommandResult
/** One page of a session's history: the local API client's `ReadPage` (local-api/client-assembly.ts). */
export type ReadPage = WireReadPage
/** A JSON object as the local API carries it: its `JsonObject` (local-api/protocol.ts). */
export type JsonObject = WireJsonObject
/** `omo account show`'s exit code and stdout: the device service bootstrap's `AccountShowResult` (device-service-core, account-state.ts). */
export type AccountShowResult = DeviceAccountShowResult

/** A failure is data, never an exception (R7, thread/errors.ts): a code, what happened and the next SDK operation. */
export type RemoteFailure = {
  readonly kind: "error"
  readonly code: RemoteCode
  readonly message: string
  readonly next_action: string
  readonly uncertain?: boolean
  readonly command_id?: string
  readonly partial?: unknown
  readonly details?: Readonly<Record<string, unknown>>
}
export type R<T> = Promise<{ readonly kind: "ok"; readonly value: T } | RemoteFailure>
/** The last parameter of every member: an abort signal and a deadline that replaces the member's default. */
export type Opts = { readonly signal?: AbortSignal; readonly deadlineMs?: number }
export type Scope = { readonly all_scope?: boolean; readonly workspace?: string }

/** Opaque: callers never parse it. `canonicalizeThreadHandle` (seams.ts) is the only parser. */
export type ThreadHandle = string

export type DeviceRow = {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly platform: string
  readonly online: boolean
  readonly last_seen_ms: number | null
  readonly self?: true
  readonly caps: { readonly attach: boolean; readonly machine: boolean; readonly control: boolean }
}
export type SessionState = "running" | "idle" | "ended"
export type SessionRow = {
  readonly thread: ThreadHandle
  readonly name: string
  readonly title: string
  readonly device: DeviceRow
  readonly project: string
  readonly path: string
  readonly state: SessionState
  readonly archived: boolean
  readonly model?: string
  readonly updated_ms: number
  readonly source: "live" | "cache"
}
export type SessionDetail = SessionRow & {
  readonly cwd: string
  readonly model: string
  readonly reasoning: string
  readonly preset: string
  readonly turn?: { readonly id: string; readonly state: string }
  readonly pending?: { readonly dialogs: number; readonly queued: number }
}
export type Attachment =
  | { readonly path: string; readonly mime?: string }
  | { readonly bytes: Uint8Array; readonly name: string; readonly mime?: string }
export type SendRequest = {
  readonly text: string
  readonly mode?: "auto" | "steer" | "follow_up"
  readonly expected_turn_id?: number
  readonly attachments?: readonly Attachment[]
  readonly idempotency_key?: string
  readonly summary?: string
  /** Only on a `connector` client; any other answers `invalid_arguments`. */
  readonly author?: Author
}
export type SendReceipt = {
  readonly thread: ThreadHandle
  readonly device: DeviceRow
  readonly delivery_id?: string
  readonly turn_id?: string
  readonly queued_id?: string
} & (
  | { readonly lane: "started" | "steered" }
  | {
      readonly lane: "queued"
      readonly queue_position: number
      readonly waiting_on?: { readonly kind: "approval"; readonly device?: string }
    }
  | { readonly lane: "queued_offline"; readonly queue_position: number; readonly wake: "started" | "none" }
)
export type PendingRequest = {
  readonly request_id: string
  readonly kind: "select" | "confirm" | "input" | "editor" | "question"
  readonly title: string
  readonly message?: string
  readonly options?: readonly string[]
  readonly secret?: boolean
  readonly tool_call_id?: string
  readonly deadline_at_ms?: number
}
export type FollowOutcome = {
  readonly reason: "settled" | "session_closed" | "interrupted" | "queued_unfollowable"
  readonly text?: string
  readonly turn_id?: string
}
export type FollowEvent =
  | { readonly kind: "receipt"; readonly receipt: SendReceipt }
  | { readonly kind: "text"; readonly delta: string }
  | {
      readonly kind: "tool_start" | "tool_update" | "tool_end"
      readonly tool_call_id: string
      readonly name: string
      readonly args?: unknown
      readonly result?: unknown
      readonly is_error?: boolean
    }
  /** Person followers only. */
  | { readonly kind: "frame"; readonly request: PendingRequest }
  | {
      readonly kind: "waiting"
      readonly state: "awaiting_approval" | "compacting" | "bash_running" | "turn_running" | "queued" | "idle"
      /** At most one of `pending` and `pending_redacted`, and only for `awaiting_approval`. */
      readonly pending?: readonly PendingRequest[]
      readonly pending_redacted?: { readonly count: number; readonly kinds: readonly PendingRequest["kind"][] }
      /** `awaiting_approval` only: where to answer it, since this client has no answer operation. */
      readonly next_action?: string
    }
  | { readonly kind: "approvals_unobservable"; readonly device: string }
  | { readonly kind: "end"; readonly outcome: FollowOutcome }
  | { readonly kind: "failed"; readonly failure: RemoteFailure }
export type RemoteStream<E> = AsyncIterable<E> & { readonly stop: () => void }
export type AttachEvent =
  | { readonly kind: "record"; readonly record: JsonObject }
  | { readonly kind: "frame"; readonly request: PendingRequest }
  | { readonly kind: "channel_lost"; readonly reason: string }
  | { readonly kind: "approvals_unobservable"; readonly device: string }
  | { readonly kind: "session_closed" }
export type AttachHandle = {
  readonly snapshot: SnapshotBody
  readonly events: RemoteStream<AttachEvent>
  readonly command: (rpc: EngineRecord) => R<CommandResult>
  readonly read: (page: { readonly before?: string; readonly tail?: number }) => R<ReadPage>
  readonly serveEndpoint: () => R<{ readonly socketPath: string; readonly sessionRef: string }>
  readonly detach: () => Promise<void>
}
export type BootstrapSetup = {
  readonly account?: AccountShowResult
  readonly install?: boolean
  readonly adopt?: boolean
}

// What the members of this part (4a-1) answer. The service rows are the device service's own, unchanged.

export type ServiceInfo = { readonly service_version: string; readonly capabilities: readonly string[] }
export type ServiceStatus = Status
export type ControlState = ControlAttachState
export type BootstrapResult =
  | { readonly kind: "connected"; readonly status: ServiceStatus }
  | { readonly kind: "stopped"; readonly state: string; readonly notice: string }
export type SessionsListFilter = {
  readonly device?: string
  readonly project?: string
  readonly state?: SessionState
  readonly archived?: boolean
  readonly name?: string
} & Scope
export type SessionsList = {
  readonly revision: number
  readonly rows: readonly SessionRow[]
  /** The devices that missed the listing round; their rows, if any, are cached. */
  readonly unanswered: readonly DeviceRow[]
}

/** Who a client acts as, fixed when it is built (design B2); a body never takes it from its parameters. */
export type RemoteSender =
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "connector"; readonly binding: string }
  | { readonly kind: "person"; readonly uid: string }
  | { readonly kind: "cli"; readonly uid: string }
  | { readonly kind: "service" }
