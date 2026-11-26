import type {
  ThreadArchiveResult,
  ThreadCloseResult,
  ThreadCreateResult,
  ThreadHandoffResult,
  ThreadInterruptResult,
  ThreadListResult,
  ThreadReadResult,
  ThreadReceiptResult,
  ThreadRenameResult,
  ThreadSendResult,
  ThreadSetModelResult,
  ThreadSetReasoningResult,
  ThreadWaitOutcome,
} from "../../../thread/contracts/results"
import type { ReleaseSessionReply } from "../../../thread/gateway/adapter"
import type { GatewayDeliverySuccess } from "../../../thread/gateway/types"
import type { LocatedThread } from "../../../thread/sdk"
import type { FollowEvent, FollowOutcome, JsonObject, ReadPage, SessionDetail, SessionRow } from "../../../remote/types"

// What each threads.* call answers (first-party design 4.4): the thread contract's ok branch, kept as it is persisted
// and printed, and for the calls the thread SDK does not have yet, an ok record in the same form whose body is the
// remote module's or the engine's own answer.
type Ok<Body> = { readonly kind: "ok"; readonly thread: string } & Body

export type {
  ThreadArchiveResult,
  ThreadCloseResult,
  ThreadCreateResult,
  ThreadHandoffResult,
  ThreadInterruptResult,
  ThreadListResult,
  ThreadReadResult,
  ThreadReceiptResult,
  ThreadRenameResult,
  ThreadSendResult,
  ThreadSetModelResult,
  ThreadSetReasoningResult,
}

/**
 * The tool's send answer plus `endpoint_kind` (design amendment on the send answer, P1b): the kind of endpoint this
 * device queued the delivery for, as `omo thread send --json` prints it. Absent when another device took the delivery.
 */
export type ThreadSendAnswer =
  | (Extract<ThreadSendResult, { readonly kind: "ok" }> & {
      readonly endpoint_kind?: GatewayDeliverySuccess["endpoint_kind"]
    })
  | Exclude<ThreadSendResult, { readonly kind: "ok" }>

export type ThreadReadAfterWaitResult = Exclude<ThreadReadResult, { readonly kind: "error" }> & {
  readonly wait: ThreadWaitOutcome
}

/** The canonical address and the row it resolved to; `thread` is the string every surface takes back (design 5). */
export type ThreadResolveResult =
  Ok<{ readonly session: SessionRow; readonly device: string }> | ThreadResolveIdentifiers

/**
 * A session principal's answer (security design 4.6, the owner's decision on revision 22): identifiers only, the thread
 * id and its device id (null: this device, with no account), never a row, an endpoint, a path or another identity.
 */
export type ThreadResolveIdentifiers = Ok<{ readonly id: string; readonly device: string | null }>

/** A session principal's located thread carries no endpoint and no session file path (the same decision). */
export type SessionLocatedThread = Omit<LocatedThread, "endpoint" | "session_path">

export type ThreadLocateResult = Ok<{ readonly located: LocatedThread | SessionLocatedThread }>

export type ThreadEntriesResult = Ok<{ readonly page: ReadPage }>

export type ThreadMessagesResult = Ok<{ readonly messages: readonly JsonObject[] }>

export type ThreadGetResult = Ok<{ readonly session: SessionDetail }>

export type ThreadWaitResult = Ok<{ readonly wait: ThreadWaitOutcome }>

/** The remote stream's nonterminal events; its own `end` and `failed` become the root stream's one terminal event. */
export type ThreadFollowEvent = Exclude<FollowEvent, { readonly kind: "end" | "failed" }>
export type ThreadFollowOutcome = FollowOutcome

/** The session left its host and stays resumable; what it dropped is named, as `omo host session unload` reports it. */
export type ThreadUnloadResult = Ok<{
  readonly unloaded: boolean
  readonly dropped_deliveries: readonly string[]
  readonly detached_children: readonly string[]
}>

/** The engine's own `release_session` reply, kept as the value: release is one of the 4.4 exceptions. */
export type ThreadReleaseResult = ReleaseSessionReply

/** The launch plan `omo daemon adopt` builds today: what to start, where, and the queued prompts to replay in order. */
export type ThreadAdoptResult = Ok<{
  readonly session_path: string
  readonly cwd: string
  readonly replay: readonly string[]
  readonly release: ReleaseSessionReply
}>

export type ThreadAliasResolveResult = Ok<{ readonly alias: string; readonly device?: string }>

export type ThreadAliasSetResult = Ok<{ readonly alias: string }>

export type ThreadAliasClearResult = Ok<{ readonly alias: string | null }>
