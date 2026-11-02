import type { RunnerOutcome } from "./in-process/child-handle"

/**
 * The child's own async work that outlives its turn, read from the engine's lifecycle (omo#10487).
 *
 * senpi folds every producer of session-owned work - a detached eval cell, a background terminal
 * job, a terminal monitor, an armed goal timer, a spawned child it still owns - into one record,
 * `SessionLifecycle.waitingOn` (`background` sources and the `children` count). That record is the
 * engine's own answer to "is this session done?", it rides `get_state`, the `session_lifecycle`
 * stream record and the in-process `AgentSession.lifecycle` getter alike, and it already includes the
 * producers that publish only on the engine's internal bus. A child whose turn ended while it is
 * non-empty has not produced its final answer: the work's completion wakes it into the turn that does.
 */
export type PendingAsyncWorkSource = {
  readonly source: string
  readonly activeCount: number
  readonly labels: readonly string[]
}

export type PendingAsyncWork = {
  readonly sources: readonly PendingAsyncWorkSource[]
  readonly children: number
}

// A team member publishes this source while it is on duty (team/member-extension/member-session.ts):
// it keeps the resident session from being parked, and every member turn is still a complete reply,
// so it is residency, not work a turn left pending.
export const MEMBER_RESIDENCY_WAKE_SOURCE = "senpi-task-member"

export function isPendingWorkSource(source: string): boolean {
  return source !== MEMBER_RESIDENCY_WAKE_SOURCE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function waitItemLabels(items: unknown): readonly string[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    if (!isRecord(item)) return []
    const label = [item.label, item.description, item.id].find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    )
    return label === undefined ? [] : [label]
  })
}

function readSource(entry: unknown): PendingAsyncWorkSource | undefined {
  if (!isRecord(entry) || typeof entry.source !== "string" || !isPendingWorkSource(entry.source)) return undefined
  const count = entry.activeCount
  if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) return undefined
  return { source: entry.source, activeCount: count, labels: waitItemLabels(entry.items) }
}

/**
 * Parse a lifecycle snapshot. `undefined`: the engine sent no readable lifecycle (an older engine),
 * so the caller falls back to whatever else it observes. `null`: the engine says nothing is pending.
 */
export function readLifecyclePendingWork(lifecycle: unknown): PendingAsyncWork | null | undefined {
  if (!isRecord(lifecycle) || typeof lifecycle.state !== "string") return undefined
  const waits = lifecycle.waitingOn
  if (!isRecord(waits)) return null
  const background = Array.isArray(waits.background) ? waits.background : []
  const sources = background.flatMap((entry) => {
    const source = readSource(entry)
    return source === undefined ? [] : [source]
  })
  const children = typeof waits.children === "number" && Number.isInteger(waits.children) && waits.children > 0 ? waits.children : 0
  return sources.length === 0 && children === 0 ? null : { sources, children }
}

export function pendingWorkSignature(work: PendingAsyncWork): string {
  return JSON.stringify([work.children, work.sources.map((source) => [source.source, source.activeCount, source.labels])])
}

export function describePendingAsyncWork(work: PendingAsyncWork): string {
  const parts = work.sources.map((source) => {
    const labels = source.labels.length === 0 ? "" : ` [${source.labels.slice(0, 3).join(", ")}${source.labels.length > 3 ? ", ..." : ""}]`
    return `${source.source}: ${source.activeCount}${labels}`
  })
  if (work.children > 0) parts.push(`child tasks: ${work.children}`)
  return parts.join("; ")
}

export const ASYNC_WORK_PENDING_KIND = "async_work_pending"

export function asyncWorkPendingOutcome(work: PendingAsyncWork, why: string): RunnerOutcome {
  return {
    status: "error",
    failure: {
      kind: ASYNC_WORK_PENDING_KIND,
      message: `The child ended its turn while its own async work was still pending (${describePendingAsyncWork(work)}); ${why}. Its last reply was a progress note, not its result.`,
    },
  }
}
