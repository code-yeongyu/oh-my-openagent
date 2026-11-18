import { THREAD_ACTIVITIES, THREAD_STATES, type ThreadActivity, type ThreadModel, type ThreadState } from "../contracts"
import type { RemoteSessionRow } from "../remote/ports"

/**
 * The one state rule (#13403, #13407): the archived flag wins; a thread no engine holds (closed, its endpoint dead or
 * degraded, known only from disk, a row another device's cached listing still names) is `inactive`; otherwise the
 * engine's activity. A field an older engine does not report reads as not archived and idle.
 */
export function threadState(facts: {
  readonly archived?: unknown
  readonly held: boolean
  readonly activity?: unknown
}): ThreadState {
  if (facts.archived === true) return "archived"
  if (!facts.held) return "inactive"
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
