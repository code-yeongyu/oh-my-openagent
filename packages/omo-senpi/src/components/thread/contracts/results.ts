import type { ThreadErrorCode, ThreadToolFailure } from "../errors"
import type { BindingRecord, OutboxRow } from "../gateway/bindings"
import type { ThreadWorktree } from "../worktree/thread-worktree"
import type { ThreadActivity, ThreadModel, ThreadState } from "./state"

export { THREAD_ACTIVITIES, THREAD_STATES, type ThreadActivity, type ThreadModel, type ThreadState } from "./state"

// Discriminated result unions. The error branch is shared data, never an exception: a caller
// that sent a malformed payload receives { kind: "error", error: { code: "invalid_arguments" } }.

export type ThreadDataError = { readonly kind: "error"; readonly error: ThreadToolFailure }

/** Deprecated beside `state`, kept for one release: `resumable` when no engine holds the thread, else `live`. */
export type ThreadStatus = "live" | "resumable"

/**
 * A thread as the address book and the controls hold it, never as a tool answers it: `thread_id` is its durable id and
 * `endpoint` names the socket and routing id that reach it. Tool results carry `ThreadResultSummary` instead.
 */
export type ThreadSummary = {
  readonly thread_id: string
  readonly name: string
  readonly status: ThreadStatus
  readonly cwd: string
  readonly created_at: string
  readonly updated_at: string | null
  /** Present only on a thread listed from disk because its endpoint stopped answering. */
  readonly error_note?: string
  /** The endpoint serving the thread: a host (`rpc_host`, with the session's routing id) or a terminal (`tui`). */
  readonly endpoint?: {
    readonly kind: "rpc_host" | "tui"
    readonly socket: string
    readonly routing_id: string | null
    readonly durable_session_id: string
  } | null
  readonly surface?: "tui" | "desktop" | "child" | "daemon" | null
  /** What a caller can do to this thread through its endpoint; an older terminal accepts only send, read and rename. */
  readonly controls?: readonly ("send" | "read" | "rename" | "set_model" | "set_reasoning" | "interrupt")[]
  /** `thread_create` only: the initial skills attached to the new thread (`initial-skills.ts`). */
  readonly skills?: readonly string[]
  /** The account device that holds the thread, when it is not this device's (A3: resolved from the account's session list). */
  readonly device?: string
  /** The thread's account-wide alias, usable instead of its id in every thread tool. */
  readonly alias?: string
}

/**
 * A thread as a tool result names it (#14044 step 4a). `thread` is the exact string every thread tool takes back as its
 * `thread` input (today the durable id); no other field names the session, and no endpoint internal (socket, session
 * file, routing id) is shown. `machine` is the display name of the device that holds it, when known. `link` is
 * `[title](omo-thread://v1/<thread>)` (`thread-link.ts`), pasted when telling the user about the thread.
 * A result stored by an earlier build and replayed for the same idempotency key (30-day receipt retention) is answered
 * in this shape too: `currentResult` (`tools/thread-row.ts`) maps its `thread_id` or nested `thread`, rows, candidates
 * and endpoint kind, and rebuilds a missing `link`.
 */
export type ThreadResultSummary = {
  readonly thread: string
  readonly name: string
  readonly status: ThreadStatus
  readonly machine?: string
  readonly cwd: string
  readonly created_at: string
  readonly updated_at: string | null
  readonly link: string
  /** The account device that holds the thread, when it is not this device's: pass it as thread_create's `device`. */
  readonly device?: string
  /** The thread's account-wide alias, usable instead of `thread` in every thread tool. */
  readonly alias?: string
  readonly surface?: ThreadSummary["surface"]
  /** What the thread is doing (`contracts/state.ts`); a thread has no online state, `online` is a device's. */
  readonly state: ThreadState
  /** The thread's current model; absent when its engine does not report one (an older engine, an inactive thread). */
  readonly model?: ThreadModel
  /** A held thread's finer activity when its engine reports one (an older engine reports none). */
  readonly activity?: ThreadActivity
  /** With `activity: "errored"`: the failed turn's category. */
  readonly error_code?: string
  /** The current or most recent turn's id, as the prompt response names it. */
  readonly turn_id?: string
  /**
   * Set when the row comes from another device's cached listing (it did not answer this round): when that listing was
   * taken. Such a row is the device's last word, so it reads `inactive` (or `archived`), never `running`.
   */
  readonly as_of?: string
  readonly controls?: ThreadSummary["controls"]
  /** Present only on a thread listed from disk because its endpoint stopped answering. */
  readonly error_note?: string
  /** `thread_create` only: the initial skills attached to the new thread (`initial-skills.ts`). */
  readonly skills?: readonly string[]
}

export type ThreadDelivery =
  | { readonly kind: "steered"; readonly turn_id: string }
  | { readonly kind: "started"; readonly turn_id: string }
  /**
   * `waiting_on`: what the message waits on, on that device (`device`, absent when this install has no device identity):
   * an `approval` a human must answer, a `hold` on the session (a Stop, a pause), or the `wake` of a session no engine runs
   * (omo#13037); the message runs after it.
   */
  | {
      readonly kind: "queued"
      readonly queue_position: number
      readonly waiting_on?: { readonly kind: "approval" | "hold" | "wake"; readonly device?: string }
    }
  /** Gateway only: the target has no answering endpoint; the message is durable and its drain takes it on the next start. */
  | { readonly kind: "queued_offline"; readonly queue_position: number; readonly reason?: "wake_unavailable" }

/**
 * What a send through the session gateway adds to a delivery result: the durable `delivery_id` and the lane the target
 * used (`steer` / `follow_up`, or the requested mode while it waits). The kind of endpoint that served the target is an
 * endpoint internal (#14044): only the SDK's send (`endpoint_kind`, for `omo thread send` and connectors) reports it.
 */
export type ThreadGatewayDeliveryFacts = {
  readonly delivery_id?: string
  readonly effective_mode?: "auto" | "steer" | "follow_up"
}

export type ThreadAddressResolution = "id" | "exact_name" | "fuzzy"

export type ThreadReadSource = "live_host" | "session_jsonl"

export type ThreadTranscriptItem = {
  readonly seq: number
  readonly role: "user" | "assistant" | "tool" | "system"
  readonly content: string
}

/**
 * `alias_scope: "local"` (#13104): no account could hold the alias (`alias_unavailable` says why), so it is only the
 * thread's name on its device - addressable there like any name, never account-wide.
 */
export type ThreadLocalAliasNote = {
  readonly alias_scope?: "local"
  readonly alias_unavailable?: "sign_in" | "no_registry" | "no_remote"
  /**
   * Set only when the account was gone by the alias claim, after thread_create had made the thread: the alias could
   * not become its local name (`name_conflict` with another thread, the code that refused the rename, or
   * `host_unavailable` when the rename failed with no typed refusal), so the thread keeps the name it was created with.
   */
  readonly local_name_unavailable?: ThreadErrorCode
  /**
   * Set only with `local_name_unavailable: "host_unavailable"` from a rename that failed with no typed refusal: the
   * error's message (its string form when the thrown value is not an Error), capped at 300 code points with an ellipsis,
   * so a failure in the rename path is traceable instead of a bare code.
   */
  readonly local_name_unavailable_reason?: string
}

/**
 * Set when a thread this device opened is in a folder outside the caller's workspace: every thread tool answers it
 * `scope_denied` from the caller unless `all_scope` is set, which `scope_next_action` says.
 */
export type ThreadWorkspaceNote = { readonly workspace_scope?: "outside"; readonly scope_next_action?: string }

/**
 * The first message a `thread_create` with `prompt` delivered to the thread it made (#13410): the delivery as thread_send
 * reports it, or the failure that stopped it. The thread exists either way.
 */
export type ThreadCreatePrompt =
  | ({ readonly delivery: ThreadDelivery; readonly deduplicated: boolean } & ThreadGatewayDeliveryFacts)
  | { readonly error: ThreadToolFailure }

/** `thread_create` answers the thread it made or opened flat: its `thread` is the address to pass back. */
export type ThreadCreateResult =
  | (ThreadResultSummary & {
      readonly kind: "ok"
      readonly deduplicated: boolean
      readonly prompt?: ThreadCreatePrompt
      readonly requested_skills?: readonly string[]
      /** The git worktree the new thread was started in, when thread_create asked for one. */
      readonly worktree?: ThreadWorktree
      /** Steps after the session was created that failed; the thread exists anyway. */
      readonly warnings?: readonly ThreadToolFailure[]
    } & ThreadLocalAliasNote &
      ThreadWorkspaceNote)
  | ThreadDataError

/**
 * One of the account's devices as `thread_list` reports it. `online` is the device's, never a thread's. `listing`:
 * `listed` when this listing holds the device's threads, `incomplete` when the device did not answer this round (its
 * threads are missing, not gone), `offline` when the device is not connected. `threads` counts the threads this result
 * lists on the device (this device's are the caller's scoped threads). This device's row is always present.
 */
export type ThreadDevice = {
  readonly device: string
  readonly name: string
  readonly platform?: string
  readonly kind?: string
  readonly online: boolean
  readonly last_seen: string | null
  readonly this_device: boolean
  readonly listing: "listed" | "incomplete" | "offline"
  readonly threads: number
}

export type ThreadListResult =
  | {
      readonly kind: "ok"
      readonly threads: readonly ThreadResultSummary[]
      readonly scope: "workspace" | "all"
      /** The account's devices, this one included, when the account's devices could be listed. */
      readonly devices?: readonly ThreadDevice[]
      /**
       * Set when the account's other devices could not be listed (A5: `relay_requires_paid_plan`, or the device service is
       * unreachable), or `devices_unavailable` when only the device roster failed (the threads are still merged).
       */
      readonly remote_unavailable?: string
      /**
       * Set when the threads are listed without the account's aliases, so a missing alias is unknown, not free: the alias
       * registry could not be read (`sign_in`, or `host_unavailable`), or was not asked because the account's other devices
       * cannot be reached from here (`not_asked`): the device service is not connected, or it answered that the account's
       * plan has no relay (`plan_required`, a Free plan).
       */
      readonly aliases_unavailable?: "sign_in" | "host_unavailable" | "not_asked"
      /** More session files were in scope than one list reads (newest first): older inactive threads are left out. */
      readonly inactive_truncated?: true
    }
  | ThreadDataError

export type ThreadReadResult =
  | {
      readonly kind: "ok"
      readonly thread: string
      readonly link: string
      readonly items: readonly ThreadTranscriptItem[]
      readonly truncated: boolean
      readonly next_cursor?: string
      readonly source: ThreadReadSource
      /** Set on the JSONL fallback for a thread whose endpoint is dead: the file may lag the session. */
      readonly source_incomplete?: boolean
      readonly error_note?: string
      readonly device?: string
      /** Set when the read asked to wait (`wait_ms`): how the wait ended, read before the transcript. */
      readonly wait?: ThreadWaitOutcome
    }
  | ThreadDataError

/**
 * A `thread_read` wait (#13417). `settled`: a turn end was observed (`turn_id`), or the thread showed no run for the
 * quiet window and is idle (no `turn_id`); a snapshot's idle alone never settles it.
 * `timeout`: `wait_ms` passed with the thread still running. `cancelled`: the call was aborted. `ended`: the watch
 * could not continue (the session closed for good or the access ended; `status` names why).
 */
export type ThreadWaitOutcome = {
  readonly outcome: "settled" | "timeout" | "cancelled" | "ended"
  readonly status: string
  readonly waited_ms: number
  /** The turn whose observed end settled the wait; absent when the session showed no run and settled on its idle. */
  readonly turn_id?: string
}

export type ThreadSendResult =
  | ({
      readonly kind: "ok"
      readonly thread: string
      readonly link: string
      readonly delivery: ThreadDelivery
      /** The gateway row's sequence; absent for a session on another device, which has no row here. */
      readonly message_seq?: number
      readonly deduplicated: boolean
      readonly device?: string
    } & ThreadGatewayDeliveryFacts)
  | ThreadDataError

export type ThreadInterruptBackgroundJob = {
  readonly kind: string
  readonly id: string
  readonly description?: string
}

/**
 * The background jobs the interrupted turn started (background bash sessions): `stopped` ended them, so none of them
 * wakes the thread later; `not_supported` is an engine that predates the stop, where they were left running.
 */
export type ThreadInterruptBackground =
  | {
      readonly status: "stopped"
      readonly stopped: readonly ThreadInterruptBackgroundJob[]
      readonly failed: readonly (ThreadInterruptBackgroundJob & { readonly reason: string })[]
    }
  | { readonly status: "not_supported" }

export type ThreadInterruptResult =
  | {
      readonly kind: "ok"
      readonly thread: string
      readonly turn_id?: string
      readonly interrupted: boolean
      readonly background: ThreadInterruptBackground
      readonly device?: string
    }
  | ThreadDataError

/**
 * `closed` is whether this call shut the session down. `reason` is always set: `closed` when it did,
 * `not_live` when nothing live held it (the session stays as it was). `dropped_deliveries` is always set: the
 * deliveries the close handed back unread (their senders redeliver them), empty when none (omo#14234).
 */
export type ThreadCloseResult =
  | {
      readonly kind: "ok"
      readonly thread: string
      readonly closed: boolean
      readonly reason: "closed" | "not_live"
      readonly dropped_deliveries: readonly string[]
      readonly device?: string
    }
  | ThreadDataError

/** `thread_handoff` answers the thread it reached flat, like `thread_create`. */
export type ThreadHandoffResult =
  | (ThreadResultSummary & {
      readonly kind: "ok"
      readonly resolved_by: ThreadAddressResolution
      readonly delivery: ThreadDelivery
      /** The gateway row's sequence; absent for a session on another device, which has no row here. */
      readonly message_seq?: number
      readonly deduplicated: boolean
      readonly device?: string
    } & ThreadGatewayDeliveryFacts)
  | ThreadDataError

export type ThreadThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"

export type ThreadReasoningScope = "session" | "turn"

export type ThreadRenameResult =
  | ({
      readonly kind: "ok"
      readonly thread: string
      readonly name: string
      readonly alias?: string
      readonly device?: string
    } & ThreadLocalAliasNote)
  | ThreadDataError

export type ThreadSetModelResult =
  | {
      readonly kind: "ok"
      readonly thread: string
      readonly model: { readonly provider: string; readonly id: string }
      readonly device?: string
    }
  | ThreadDataError

/** The thread as `thread_list` would list it now, with the state its archived flag gives it. */
export type ThreadArchiveResult =
  ({ readonly kind: "ok"; readonly archived: boolean } & ThreadResultSummary) | ThreadDataError

export type ThreadSetReasoningResult =
  | {
      readonly kind: "ok"
      readonly thread: string
      readonly level: ThreadThinkingLevel
      readonly scope: ThreadReasoningScope
      readonly device?: string
    }
  | ThreadDataError

export type ThreadBinding = BindingRecord

export type ThreadOutboxRow = OutboxRow

export type ThreadReportResult =
  | {
      readonly kind: "ok"
      readonly binding_id: string
      readonly revision: number
      readonly event: "milestone" | "report" | "question" | "completion"
      /** The outbox row written; null for a completion, which is written when the session settles. */
      readonly cursor: number | null
      readonly reply_token: string | null
      readonly armed: boolean
      readonly deduplicated: boolean
    }
  | ThreadDataError

export type ThreadOutboxResult =
  | {
      readonly kind: "ok"
      readonly binding_id: string
      readonly revision: number
      readonly status: ThreadBinding["status"]
      readonly rows: readonly ThreadOutboxRow[]
      readonly next_cursor: number
      readonly acked_cursor: number
    }
  | ThreadDataError

export type ThreadOutboxAckResult =
  | { readonly kind: "ok"; readonly binding_id: string; readonly acked_cursor: number; readonly changed: boolean }
  | ThreadDataError

export type ThreadAnswerResult =
  | { readonly kind: "ok"; readonly binding_id: string; readonly cursor: number; readonly session_durable_id: string }
  | ThreadDataError

export type ThreadToolResult =
  | ThreadReportResult
  | ThreadOutboxResult
  | ThreadOutboxAckResult
  | ThreadAnswerResult
  | ThreadCreateResult
  | ThreadListResult
  | ThreadReadResult
  | ThreadSendResult
  | ThreadInterruptResult
  | ThreadCloseResult
  | ThreadHandoffResult
  | ThreadRenameResult
  | ThreadSetModelResult
  | ThreadSetReasoningResult
  | ThreadArchiveResult
