import type { AccountShowResult as DeviceAccountShowResult } from "../../../../device-service-core/src/account-state"
import type {
  CommandLocated,
  CommandRpc,
  CommandStateEvent,
  ControlAttachState,
  ControlSessionWakeState,
  JsonValue,
  JsonObject as WireJsonObject,
  SnapshotBody as WireSnapshotBody,
  Status,
} from "../../../../device-service-core/src/wire"
import type { PermissionPreset } from "../thread/contracts/permission-presets"
import type { AliasRegistry } from "../thread/remote/alias-port"
import type { RemoteCode } from "./codes"

// The types of the one remote module (design one-remote-module v8-core r2, section B1 and Appendix B, as confirmed).
// They reach only leaf files (types-closure.test.ts): the local API's protocol vocabulary, never the device service SDK
// or the thread gateway, so the published declarations carry no private module graph. A type the layer below declares
// in a module that imports more is restated here with the same shape; the client assigns the layer's values to it, so
// the typecheck catches a drift.

// Appendix B names seven types without their source (verdict D-04). Each comes from the layer below, unchanged:

/** The human a connector authenticated: the thread gateway's `ExternalAuthor` (thread/gateway/types.ts), same shape. */
export type Author = {
  readonly platform_user_id: string
  readonly display: string
  readonly user_id?: string
}
/** An attach's first state: the local API's `session.snapshot` body (device-service-core, local-api/protocol-events.ts). */
export type SnapshotBody = WireSnapshotBody
/** One engine RPC record, opaque here and classed by the receiving engine: the local API's `CommandRpc` (local-api/protocol.ts). */
export type EngineRecord = CommandRpc
/** How an engine record ended, with the engine's reply: the device service's `CommandResult` (device-service-core, remote-attach.ts), same shape. */
export type CommandResult = {
  readonly outcome: CommandStateEvent
  readonly response?: JsonObject
  readonly located?: CommandLocated
}
/** One page of a session's history: the local API client's `ReadPage` (local-api/client-assembly.ts), same shape. */
export type ReadPage = {
  readonly entries: readonly (
    | { readonly entry_id: string; readonly entry: JsonValue }
    | { readonly entry_id: string; readonly too_large: true; readonly bytes: number }
  )[]
  readonly next_before: string | null
}
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

/**
 * Opaque and branded: only seams.ts makes one (`canonicalizeThreadHandle`, or `handleOf` for a listed row), so a caller
 * cannot build one from text. `canonicalizeThreadHandle` is the only parser.
 */
export type ThreadHandle = string & { readonly __brand: "ThreadHandle" }

export type DeviceRow = {
  readonly id: string
  readonly name: string
  /** Absent on this device's own row when the roster does not list it: the service reports no kind for it (#13402). */
  readonly kind?: string
  readonly platform: string
  readonly online: boolean
  readonly last_seen_ms: number | null
  readonly self?: true
  readonly caps: { readonly attach: boolean; readonly machine: boolean; readonly control: boolean }
}
export type SessionState = "running" | "idle" | "ended"
export type SessionRow = {
  readonly thread: ThreadHandle
  /** The session's omo durable id when its device publishes it: the id every thread tool names it by (decision 0027 D2). */
  readonly durable_id?: string
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
  /**
   * The send's own id: the `clientMessageId` its prompt carried, which the engine stamps on every record of the turn
   * that answers it (senpi ClientMessageEvents), live and in any replay. Pass the receipt as follow/wait `from`.
   */
  readonly delivery_id?: string
  /** The engine turn the send started or steered (`get_state.currentTurnId`); absent for a queued send. */
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
  /** Followed `from` a send: that receipt's `turn_id`, the same identity. Otherwise the engine run's id. */
  readonly turn_id?: string
}
/**
 * The options of sessions.follow and sessions.wait. `from` anchors them on one send (#13753): with a receipt that carries
 * a `delivery_id`, they follow only the turn that answers that send and end on its end, whatever the attach replays;
 * without one they follow the session from now on.
 */
export type FollowOpts = Opts & { readonly from?: SendReceipt }
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
  /** A shown request ended: answered, or cancelled (also when a re-attach snapshot no longer holds it). */
  | { readonly kind: "frame_settled"; readonly request_id: string; readonly how: "answered" | "cancelled" }
  | { readonly kind: "channel_lost"; readonly reason: string }
  | { readonly kind: "approvals_unobservable"; readonly device: string }
  | { readonly kind: "session_closed" }
export type AttachHandle = {
  readonly snapshot: SnapshotBody
  readonly events: RemoteStream<AttachEvent>
  readonly command: (rpc: EngineRecord) => R<CommandResult>
  readonly read: (page: { readonly before?: string; readonly tail?: number }) => R<ReadPage>
  readonly serveEndpoint: () => R<{ readonly socketPath: string; readonly sessionRef: string }>
  /**
   * The session's pending UI requests from the latest snapshot (dialogs and questions; raiser-only ones such as secret
   * input are left out), recomputed on every snapshot, a re-attach after a relay gap included (#12750).
   */
  readonly pending: () => readonly PendingRequest[]
  /** Answers one pending request by its id (`extension_ui_response {id, uiRequestId, ...response}`). */
  readonly answer: (requestId: string, response: UiResponse) => R<{ readonly answered: true }>
  readonly detach: () => Promise<void>
}
export type BootstrapSetup = {
  readonly account?: AccountShowResult
  readonly install?: boolean
  readonly adopt?: boolean
}

// What the members of this part (4a-1) answer. The service rows are the device service's own, unchanged.

export type ServiceInfo = { readonly service_version: string; readonly capabilities: readonly string[] }
/** The service's state plus the version of the service that reported it (one call; no second `info`). */
export type ServiceStatus = Status & { readonly service_version: string }
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

// What the members of part 4a-2 take and answer (#13414 W3: the rows' confirmed shapes, recorded in remote-tools SEAMS.md).

/**
 * senpi's approval modes (permission-system/types.ts), as `open_session` takes them (`permissionPreset`): the one list
 * is the thread contracts' PERMISSION_PRESETS (thread_create narrows by it); its type is re-exported here.
 */
export type { PermissionPreset }

/**
 * One new session, opened through the shared create path (thread SessionHost.open): `workspace` is its cwd, `model` is
 * "provider/id" (an unrunnable model creates nothing: `model_not_found`, details.reason `model_unavailable`), `reasoning`
 * its thinking level, `preset` its approval mode (a session or connector caller may only keep or narrow its own:
 * wider is `scope_denied`, details.reason `permission_preset_wider`), and `first` the first prompt, delivered under the
 * same idempotency key.
 */
export type OpenRequest = {
  readonly device: string
  readonly workspace?: string
  readonly name?: string
  readonly worktree?: { readonly branch?: string; readonly base?: string }
  readonly model?: string
  readonly reasoning?: string
  readonly preset?: PermissionPreset
  readonly initial_skills?: readonly string[]
  readonly first?: SendRequest
  readonly idempotency_key?: string
}
export type OpenResult = {
  readonly thread: ThreadHandle
  readonly device: DeviceRow
  /** The first prompt's receipt, when `first` was given. */
  readonly receipt?: SendReceipt
  /** Steps after the session existed that did not apply (its name, its listing key); the session is still created. */
  readonly warnings?: readonly string[]
}

/** A background job of the interrupted turn (#13444). */
export type InterruptJob = { readonly kind: string; readonly id: string; readonly description?: string }
/**
 * The interrupt answer, in the background shape #13444 adds to the thread tools' ThreadInterruptResult: `background` is
 * always present; `not_supported` is an engine before senpi#6675, whose jobs were left running with no per-job list. This
 * is a mirror, not the thread type itself: derive it from thread/contracts/results.ts once #13444 lands on dev.
 */
export type InterruptResult = {
  readonly thread: string
  readonly turn_id?: string
  readonly interrupted: boolean
  readonly background:
    | {
        readonly status: "stopped"
        readonly stopped: readonly InterruptJob[]
        readonly failed: readonly (InterruptJob & { readonly reason: string })[]
      }
    | { readonly status: "not_supported" }
  readonly device?: string
}

/** `sessions.wait`: event-driven on the attach's watch, never a poll of `read`. */
export type WaitResult = {
  readonly outcome: "settled" | "timeout" | "cancelled" | "ended"
  readonly status: string
  readonly waited_ms: number
}

/** An answer to one pending UI request (`extension_ui_response` without its ids). */
export type UiResponse =
  | { readonly value: string }
  | { readonly values: readonly string[] }
  | { readonly confirmed: boolean }
  | { readonly cancelled: true }

/** Who a client acts as, fixed when it is built (design B2); a body never takes it from its parameters. */
export type RemoteSender =
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "connector"; readonly binding: string }
  | { readonly kind: "person"; readonly uid: string }
  | { readonly kind: "cli"; readonly uid: string }
  | { readonly kind: "service" }

/** The clock seam (device-service-core timers.ts `Timers`, same shape): `after` arms `fn` once and returns its cancel. */
type Timers = {
  readonly after: (ms: number, fn: () => void) => () => void
  readonly now: () => number
}
/** What the public types need of a proven device-service connection (device-service-core `DeviceService`). */
type DeviceServiceConnection = {
  readonly serviceVersion: string
  readonly closed: Promise<void>
  readonly close: () => void
}
/** What the public types need of a live attach (device-service-core `RemoteAttach`): its device, session and local handle. */
type RemoteAttachRef = { readonly device: string; readonly sessionId: string; readonly handle: string }

/**
 * What a remote client is built from. `Connection` and `Attach` are the device service SDK's connection and attach; the
 * client (client.ts) fixes them to `DeviceService` and `RemoteAttach`, so these types never import the SDK.
 */
export type RemoteClientDeps<
  Connection extends DeviceServiceConnection = DeviceServiceConnection,
  Attach extends RemoteAttachRef = RemoteAttachRef,
> = {
  readonly version: string
  readonly stateDir?: string
  /** The clock seam: every deadline of the client and of its connection runs on it (real timers by default). */
  readonly timers?: Timers
  /** Runs the device service bootstrap for `service.bootstrap`; the internal bootstrap entry provides it (part 4c-3). */
  readonly bootstrap?: (setup: BootstrapSetup) => Promise<BootstrapResult>
  /**
   * The account's alias registry for `aliases.*`. The caller builds it (it needs the account service access, which the
   * client must not import); absent, the alias members answer `unsupported{feature:"aliases"}`.
   */
  readonly aliasRegistry?: () => Promise<AliasRegistry>
  /**
   * Where the gateway store's worker sidecar is (`gateway-store-worker.mjs` beside the plugin's extension bundle). The
   * compiled binary passes its provisioned runtime's copy; from source the store resolves its own worker.
   */
  readonly gatewayWorkerUrl?: URL
  /**
   * Serves an attach as a local engine endpoint (`AttachHandle.serveEndpoint`): the caller hands in omo-native's
   * `serveRemoteAttach`, so the client never imports a net server into `omo remote`'s local-only graph (#13440). Absent,
   * `serveEndpoint` answers `unsupported{feature:"serve_endpoint"}`.
   */
  readonly serveAttach?: (
    attach: Attach,
    label: string,
  ) => Promise<{ readonly socketPath: string; readonly sessionRef: string; readonly close: () => Promise<void> }>
  /**
   * Attaches to a session on THIS device through its engine's operator endpoint (`remote/local-attach.ts`
   * `createLocalAttach`): the device service cannot attach a device to itself (peer_not_found). It opens a socket, so a
   * caller outside omo remote's local-only graph (#13440) injects it. Absent, attach, follow and wait on a session of
   * this device answer `unsupported{feature:"local_attach"}`.
   */
  readonly localAttach?: (target: {
    readonly device: string
    readonly session: string
    readonly durableId: string
  }) => Promise<Attach>
  /**
   * The approval mode of the session this client acts for (a session or connector sender): an open may keep or narrow
   * it, never widen it. Absent, only the narrowest mode passes.
   */
  readonly permissionPreset?: () => string | undefined
  /** Test seam: opens the proven device-service connection (`connectDeviceService` by default). */
  readonly connect?: (options: {
    readonly version: string
    readonly stateDir: string
    readonly timers: Timers
  }) => Promise<Connection>
}

/**
 * The one remote client (design v8-core r2, B1, with the #13414 W3 rows' shapes). Members of 4a-1 live in client.ts; each
 * later member lives in its own module (sessions.ts, follow.ts, attach.ts, aliases.ts, resolve.ts) and is built from the
 * same `ClientCore`, so every member shares the one connection, the sender and the deadlines.
 */
export type RemoteClient = {
  readonly service: {
    readonly info: (opts?: Opts) => R<ServiceInfo>
    readonly status: (opts?: Opts) => R<ServiceStatus>
    readonly setEnabled: (on: boolean, opts?: Opts) => R<{ readonly enabled: boolean }>
    readonly control: (opts?: Opts) => R<ControlState>
    readonly setControl: (on: boolean, opts?: Opts) => R<ControlState>
    readonly bootstrap: (setup: BootstrapSetup, opts?: Opts) => R<BootstrapResult>
    /** The device's session-wake switch (omo#13037 A7.2.5); `unsupported{feature:"wake"}` below the service that carries it. */
    readonly wake: (opts?: Opts) => R<ControlSessionWakeState>
    /** Sets the switch; `null` removes the stored value (the default applies). Person only. */
    readonly setWake: (on: boolean | null, opts?: Opts) => R<ControlSessionWakeState>
  }
  readonly devices: {
    readonly list: (opts?: Opts) => R<readonly DeviceRow[]>
    readonly resolve: (idOrName: string, opts?: Opts) => R<DeviceRow>
  }
  readonly sessions: {
    readonly list: (filter?: SessionsListFilter, opts?: Opts) => R<SessionsList>
    /** One address (durable id, alias, name, `<device>/<session>`) to its row, on the cached listing (no relist per op). */
    readonly resolve: (address: string, scope?: Scope, opts?: Opts) => R<SessionRow>
    readonly get: (thread: ThreadHandle, opts?: Opts) => R<SessionDetail>
    readonly open: (request: OpenRequest, opts?: Opts) => R<OpenResult>
    readonly send: (thread: ThreadHandle, request: SendRequest, opts?: Opts) => R<SendReceipt>
    readonly read: (
      thread: ThreadHandle,
      page?: { readonly before?: string; readonly tail?: number },
      opts?: Opts,
    ) => R<ReadPage>
    /**
     * Status changes, turn ends and the turn's stream, from now on (or, with `opts.from`, the turn that answers that
     * send); survives relay, service and engine restarts.
     */
    readonly follow: (thread: ThreadHandle, opts?: FollowOpts) => RemoteStream<FollowEvent>
    readonly wait: (thread: ThreadHandle, opts?: FollowOpts) => R<WaitResult>
    readonly interrupt: (thread: ThreadHandle, opts?: Opts) => R<InterruptResult>
    /** The session's own model ("provider/id"); never a device default. */
    readonly setModel: (thread: ThreadHandle, model: string, opts?: Opts) => R<{ readonly model: string }>
    /** The session's own thinking level; never a device default. */
    readonly setReasoning: (thread: ThreadHandle, level: string, opts?: Opts) => R<{ readonly reasoning: string }>
    readonly close: (thread: ThreadHandle, opts?: Opts) => R<{ readonly closed: boolean }>
    readonly archive: (thread: ThreadHandle, archived: boolean, opts?: Opts) => R<{ readonly archived: boolean }>
  }
  /** One session's live attach: its snapshot, records, pending UI requests and their answers. */
  readonly attach: (thread: ThreadHandle, opts?: Opts) => R<AttachHandle>
  readonly aliases: {
    readonly resolve: (alias: string, opts?: Opts) => R<ThreadHandle>
    readonly set: (thread: ThreadHandle, alias: string, opts?: Opts) => R<{ readonly alias: string }>
    readonly clear: (thread: ThreadHandle, opts?: Opts) => R<{ readonly released: boolean }>
  }
  readonly close: () => void
}
