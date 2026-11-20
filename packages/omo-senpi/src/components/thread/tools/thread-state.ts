import {
  THREAD_ACTIVITIES,
  THREAD_STATES,
  type ThreadActivity,
  type ThreadModel,
  type ThreadRetryWait,
  type ThreadState,
} from "../contracts"
import type { RemoteSessionRow } from "../remote/ports"

/**
 * The one state rule (#13403, #13407): the archived flag wins; a thread no engine holds (closed, its endpoint dead or
 * degraded, known only from disk, a row another device's cached listing still names) is `inactive`; otherwise the
 * engine's activity. A field an older engine does not report reads as not archived and idle.
 */
export function threadState(facts: {
  readonly archived?: unknown
  readonly held: boolean
  readonly opening?: boolean
  readonly activity?: unknown
}): ThreadState {
  if (facts.archived === true) return "archived"
  if (!facts.held) return "inactive"
  if (facts.opening) return "opening"
  // A queued or approval-waiting thread is mid-turn: running. A failed turn has ended: idle (its detail says errored).
  return facts.activity === "running" || facts.activity === "queued" || facts.activity === "awaiting_approval"
    ? "running"
    : "idle"
}

const ACTIVITIES: ReadonlySet<unknown> = new Set(THREAD_ACTIVITIES)
const isActivity = (value: unknown): value is ThreadActivity => ACTIVITIES.has(value)

/** A held thread's activity detail as its engine reports it; nothing for an older engine or a thread no engine holds. */
export function activityDetail(
  held: boolean,
  activity: unknown,
  errorCode: unknown,
  turnId: unknown,
): { readonly activity?: ThreadActivity; readonly error_code?: string; readonly turn_id?: string } {
  if (!held || !isActivity(activity)) return {}
  return {
    activity,
    ...(activity === "errored" && typeof errorCode === "string" && errorCode !== "" ? { error_code: errorCode } : {}),
    ...(typeof turnId === "string" && turnId !== "" ? { turn_id: turnId } : {}),
  }
}

const RETRY_WAIT_KINDS: ReadonlySet<unknown> = new Set(["rate_limit", "retry"])

/**
 * A running thread asleep between provider retries, from senpi#7025's `waiting` on its list_sessions row
 * (`{kind: "rate_limit" | "retry", attempt, maxAttempts, delayMs, until, error?}`): it is still `running`, and
 * `waiting_on` says it waits on a retry until `until`. Nothing for an older engine, a thread that is not running, or a
 * wait of a shape this build does not know.
 */
export function retryWait(running: boolean, waiting: unknown): { readonly waiting_on?: ThreadRetryWait } {
  if (!running || typeof waiting !== "object" || waiting === null) return {}
  const kind: unknown = Reflect.get(waiting, "kind")
  const until: unknown = Reflect.get(waiting, "until")
  const attempt: unknown = Reflect.get(waiting, "attempt")
  const maxAttempts: unknown = Reflect.get(waiting, "maxAttempts")
  if (
    !RETRY_WAIT_KINDS.has(kind) ||
    typeof until !== "string" ||
    Number.isNaN(Date.parse(until)) ||
    !Number.isInteger(attempt) ||
    !Number.isInteger(maxAttempts)
  )
    return {}
  return {
    waiting_on: {
      kind: "retry",
      reason: kind as ThreadRetryWait["reason"],
      until,
      attempt: attempt as number,
      max_attempts: maxAttempts as number,
    },
  }
}

/** A reported model, when it is exactly a non-empty provider and id. */
export function threadModel(value: unknown): { readonly model?: ThreadModel } {
  if (typeof value !== "object" || value === null) return {}
  const provider: unknown = Reflect.get(value, "provider")
  const id: unknown = Reflect.get(value, "id")
  return typeof provider === "string" && provider !== "" && typeof id === "string" && id !== ""
    ? { model: { provider, id } }
    : {}
}

/**
 * Another device's listing row: the archived flag wins; an ended row, or one its device's cached listing still names
 * (the device did not answer, #14043), is inactive; else the row's own running or idle.
 */
export function rowState(row: RemoteSessionRow): ThreadState {
  return threadState({
    archived: row.archived,
    held: row.state !== "ended" && row.source !== "cache",
    activity: row.state,
  })
}

/** The states a `thread_list` returns: the ones asked for, else every state but `archived`. */
export function listedStates(asked: readonly ThreadState[] | undefined): ReadonlySet<ThreadState> {
  return new Set(asked ?? THREAD_STATES.filter((state) => state !== "archived"))
}
