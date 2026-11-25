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

export type ThreadReadAfterWaitResult = Exclude<ThreadReadResult, { readonly kind: "error" }> & {
  readonly wait: ThreadWaitOutcome
}

/** The canonical address and the row it resolved to; `thread` is the string every surface takes back (design 5). */
export type ThreadResolveResult = Ok<{ readonly session: SessionRow; readonly device: string }>

export type ThreadLocateResult = Ok<{ readonly located: LocatedThread }>

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
