/**
 * What a thread is doing (#13403, #13407): `running` (a turn in flight), `idle` (an engine holds it, no turn), `inactive`
 * (its session file exists but no engine holds it: closed, its endpoint dead or degraded, known only from disk, or a row
 * another device's cached listing still names), or `archived` (its session file carries the archived flag, whatever else
 * holds). A thread has no online state; `online` belongs to devices.
 */
export type ThreadState = "running" | "idle" | "inactive" | "archived"

export const THREAD_STATES: readonly ThreadState[] = ["running", "idle", "inactive", "archived"]

/** The engine's finer activity of a held thread (senpi#6688); `state` folds it to running or idle. */
export const THREAD_ACTIVITIES = ["idle", "running", "awaiting_approval", "queued", "errored"] as const
export type ThreadActivity = (typeof THREAD_ACTIVITIES)[number]

/** The model a thread runs, as its engine names it. */
export type ThreadModel = { readonly provider: string; readonly id: string }
