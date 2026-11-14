import type { SentinelEvent } from "./events.ts"

// An app whose window observer failed while it was not a regular app is not judged at that moment. If it activates
// inside the recording it had a user interface, and from its failure until it registered again (observer_late) or
// the recording stopped, a sheet it showed was invisible to every branch of the dialog detector.

type Failure = { readonly since: number; readonly policy: string }

export const quietlyFailed = (events: readonly SentinelEvent[]): ReadonlySet<number> =>
  new Set(events.flatMap((event) => (event.kind === "observer_failed" && !event.regular ? [event.pid] : [])))

export function activatedGapFaults(
  ordered: readonly SentinelEvent[],
  from: number,
  until: number,
  targetPids: ReadonlySet<number>,
): string[] {
  const failed = new Map<number, Failure>()
  const activatedAt = new Map<number, number>()
  const reRegisteredAt = new Map<number, number>()
  for (const event of ordered) {
    if (event.kind === "observer_failed" && !event.regular && !targetPids.has(event.pid))
      failed.set(event.pid, { since: event.since, policy: event.policy })
    else if (
      event.kind === "activation" &&
      failed.has(event.pid) &&
      !activatedAt.has(event.pid) &&
      event.t > from &&
      event.t <= until
    )
      activatedAt.set(event.pid, event.t)
    else if (event.kind === "observer_late" && activatedAt.has(event.pid) && !reRegisteredAt.has(event.pid))
      reRegisteredAt.set(event.pid, event.t)
  }
  const faults: string[] = []
  for (const [pid] of activatedAt) {
    const failure = failed.get(pid)
    if (failure === undefined) continue
    const blind = Math.min(reRegisteredAt.get(pid) ?? until, until) - Math.max(failure.since, from)
    if (blind > 0)
      faults.push(
        `dialog: window observer for pid ${pid} was missing after the app activated (it had failed as ${failure.policy}; ${blind} ms without one inside the recording)`,
      )
  }
  return faults
}
