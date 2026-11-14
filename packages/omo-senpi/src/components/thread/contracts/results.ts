import type { ThreadErrorCode, ThreadToolFailure } from "../errors"
import type { BindingRecord, OutboxRow } from "../gateway/bindings"

// Discriminated result unions. The error branch is shared data, never an exception: a caller
// that sent a malformed payload receives { kind: "error", error: { code: "invalid_arguments" } }.

export type ThreadDataError = { readonly kind: "error"; readonly error: ThreadToolFailure }

/** Deprecated beside `state`, kept for one release: `resumable` when no engine holds the thread (`inactive`), else `live`. */
export type ThreadStatus = "live" | "resumable"

/**
 * What a thread is doing (#13403, #13407): `running` (a turn in flight), `idle` (an engine holds it, no turn), `inactive`
 * (its session file exists but no engine holds it: closed, its endpoint dead or degraded, or known only from disk), or
 * `archived` (its session file carries the archived flag, whatever else holds). A thread has no online state; `online`
 * belongs to devices.
 */
export type ThreadState = "running" | "idle" | "inactive" | "archived"

/** The engine's finer activity of a held thread (senpi#6688); `state` folds it to running or idle. */
export type ThreadActivity = "idle" | "running" | "awaiting_approval" | "queued" | "errored"

export const THREAD_STATES: readonly ThreadState[] = ["running", "idle", "inactive", "archived"]

/** The model a thread runs as its engine names it. */
export type ThreadModel = { readonly provider: string; readonly id: string }

/** What addressing reads of a thread: every summary field except the ones a listing derives (`state`, `model`). */
export type ThreadIdentity = {
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

export type ThreadSummary = ThreadIdentity & {
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
   * taken. Such a row is the device's last word, so its state is never `running`.
   */
  readonly as_of?: string
}

/**
 * A thread as a tool result names it: `link` is `[title](omo-thread://v1/<thread_id>)` (`thread-link.ts`), pasted when telling the user about the thread.
 * A `thread_create`, `thread_list` or `thread_read` result stored before links existed and replayed for the same idempotency key (30-day retention) has no `link`.
 */
export type ThreadResultSummary = ThreadSummary & { readonly link: string }

export type ThreadDelivery =
  | { readonly kind: "steered"; readonly turn_id: string }
  | { readonly kind: "started"; readonly turn_id: string }
  /** `waiting_on`: the receiver is parked on an approval a human must answer on that device (`device`, absent when this install has no device identity); the message runs after it. */
  | {
      readonly kind: "queued"
      readonly queue_position: number
      readonly waiting_on?: { readonly kind: "approval"; readonly device?: string }
    }
  /** Gateway only: the target has no answering endpoint; the message is durable and its drain takes it on the next start. */
  | { readonly kind: "queued_offline"; readonly queue_position: number }

/**
 * What a send through the session gateway adds to a delivery result: the durable `delivery_id`, the
 * lane the target used (`steer` / `follow_up`, or the requested mode while it waits), and the kind
 * of endpoint that serves the target (null when none answered).
 */
export type ThreadGatewayDeliveryFacts = {
  readonly delivery_id?: string
  readonly effective_mode?: "auto" | "steer" | "follow_up"
  readonly endpoint?: { readonly kind: "rpc_host" | "tui" } | null
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
   * not become its local name (`name_conflict` with another thread, or the code that refused the rename), so the
   * thread keeps the name it was created with.
   */
  readonly local_name_unavailable?: ThreadErrorCode
}

export type ThreadCreateResult =
  | ({
      readonly kind: "ok"
      readonly thread: ThreadResultSummary
      readonly deduplicated: boolean
    } & ThreadLocalAliasNote)
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
      /** More session files were in scope than one list reads (`DISK_LIST_MAX_SESSIONS`, newest first): older inactive threads are left out. */
      readonly inactive_truncated?: true
      /**
       * Set when the account's other devices could not be listed (A5: `relay_requires_paid_plan`, or the device service is
       * unreachable), or `devices_unavailable` when only the device roster failed (the threads are still merged).
       */
      readonly remote_unavailable?: string
    }
  | ThreadDataError

export type ThreadReadResult =
  | {
      readonly kind: "ok"
      readonly thread_id: string
      readonly link: string
      readonly items: readonly ThreadTranscriptItem[]
      readonly truncated: boolean
      readonly next_cursor?: string
      readonly source: ThreadReadSource
      /** Set on the JSONL fallback for a thread whose endpoint is dead: the file may lag the session. */
      readonly source_incomplete?: boolean
      readonly error_note?: string
      readonly device?: string
    }
  | ThreadDataError

export type ThreadSendResult =
  | ({
      readonly kind: "ok"
      readonly thread_id: string
      readonly link: string
      readonly delivery: ThreadDelivery
      /** The gateway row's sequence; absent for a session on another device, which has no row here. */
      readonly message_seq?: number
      readonly deduplicated: boolean
      readonly device?: string
    } & ThreadGatewayDeliveryFacts)
  | ThreadDataError

export type ThreadInterruptResult =
  | {
      readonly kind: "ok"
      readonly thread_id: string
      readonly turn_id?: string
      readonly interrupted: boolean
      readonly device?: string
    }
  | ThreadDataError

/** `closed` is false when no live owner held the thread, so there was nothing to close. */
export type ThreadCloseResult =
  | { readonly kind: "ok"; readonly thread_id: string; readonly closed: boolean; readonly device?: string }
  | ThreadDataError

export type ThreadHandoffResult =
  | ({
      readonly kind: "ok"
      readonly thread: ThreadResultSummary
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
      readonly thread_id: string
      readonly name: string
      readonly alias?: string
      readonly device?: string
    } & ThreadLocalAliasNote)
  | ThreadDataError

export type ThreadSetModelResult =
  | {
      readonly kind: "ok"
      readonly thread_id: string
      readonly model: { readonly provider: string; readonly id: string }
      readonly device?: string
    }
  | ThreadDataError

/** `thread`: the thread as `thread_list` would list it now, with the state the archive flag gives it. */
export type ThreadArchiveResult =
  | {
      readonly kind: "ok"
      readonly thread: ThreadResultSummary
      readonly archived: boolean
      readonly device?: string
    }
  | ThreadDataError

export type ThreadSetReasoningResult =
  | {
      readonly kind: "ok"
      readonly thread_id: string
      readonly level: ThreadThinkingLevel
      readonly scope: ThreadReasoningScope
      readonly device?: string
    }
  | ThreadDataError

export type ThreadBinding = BindingRecord

export type ThreadOutboxRow = OutboxRow

export type ThreadBindResult =
  { readonly kind: "ok"; readonly binding: ThreadBinding; readonly deduplicated: boolean } | ThreadDataError

export type ThreadUnbindResult =
  | {
      readonly kind: "ok"
      readonly binding: ThreadBinding
      /** True when the binding was already detached or expired: the call replays success and changes nothing. */
      readonly already_closed: boolean
      /** Deliveries accepted through this binding that the session has not taken yet. */
      readonly in_flight: readonly string[]
      readonly deduplicated: boolean
    }
  | ThreadDataError

export type ThreadRebindResult =
  | {
      readonly kind: "ok"
      readonly binding: ThreadBinding
      /** Deliveries queued under the old revision, closed with a binding_closed refusal instead of being moved. */
      readonly closed: readonly string[]
      readonly deduplicated: boolean
    }
  | ThreadDataError

export type ThreadBindingsResult =
  | { readonly kind: "ok"; readonly bindings: readonly ThreadBinding[]; readonly next_cursor: string | null }
  | ThreadDataError

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
  | ThreadBindResult
  | ThreadUnbindResult
  | ThreadRebindResult
  | ThreadBindingsResult
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
