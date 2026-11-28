import type { SentinelEvent } from "./events.ts"

// The one judgement of the recorder's window-observer facts. Each fact is a gap of one pid: from `since` until it
// registered (observer_late) or for good (observer_failed); a sheet in that gap was invisible to every branch of the
// dialog detector. Facts are read per pid in time order:
//
// - A failure while the app was not regular opens a quiet window at its `since`. The app then had no user interface,
//   so the window is judged only if the app activates before stop (before start too); it is closed by the app's next
//   registration fact (observer_late, or a regular observer_failed: its registration on activation failed again, so
//   the gap runs on until stop). Its in-recording part is one fault, whatever facts fall inside it.
// - Every other fact, before a quiet window opened or after it closed, is judged on its own when the app was regular.
//
// So a quiet failure suppresses exactly the facts inside its own window, never a gap before it or after it.

type ObserverFact = Extract<SentinelEvent, { readonly kind: "observer_failed" | "observer_late" }>
type QuietWindow = { readonly since: number; readonly policy: string; activatedAt?: number }

export function observerGapFaults(
  ordered: readonly SentinelEvent[],
  from: number,
  until: number,
  targetPids: ReadonlySet<number>,
): string[] {
  const faults: string[] = []
  const quiet = new Map<number, QuietWindow>()
  const inRecording = (since: number, end: number): number => Math.min(end, until) - Math.max(since, from)
  const judgeQuiet = (pid: number, window: QuietWindow, end: number): void => {
    const blind = inRecording(window.since, end)
    if (window.activatedAt !== undefined && blind > 0)
      faults.push(
        `dialog: window observer for pid ${pid} was missing after the app activated (it had failed as ${window.policy}; ${blind} ms without one inside the recording)`,
      )
  }
  const judgeOwn = (fact: ObserverFact): void => {
    if (!fact.regular) return
    if (fact.kind === "observer_failed") {
      if (fact.since <= until)
        faults.push(
          `dialog: window observer for pid ${fact.pid} did not register after ${fact.attempts} attempts (AX ${fact.axError})`,
        )
      return
    }
    const blind = inRecording(fact.since, fact.t)
    if (blind > 0)
      faults.push(
        `dialog: window observer for pid ${fact.pid} registered only after ${fact.attempts} attempts (${blind} ms without one inside the recording)`,
      )
  }

  for (const event of ordered) {
    if (event.kind === "activation") {
      const window = quiet.get(event.pid)
      if (window !== undefined && window.activatedAt === undefined && event.t <= until) window.activatedAt = event.t
      continue
    }
    if ((event.kind !== "observer_failed" && event.kind !== "observer_late") || targetPids.has(event.pid)) continue
    const window = quiet.get(event.pid)
    if (window === undefined) {
      if (event.kind === "observer_failed" && !event.regular)
        quiet.set(event.pid, { since: event.since, policy: event.policy })
      else judgeOwn(event)
    } else if (event.kind === "observer_late") {
      judgeQuiet(event.pid, window, event.t)
      quiet.delete(event.pid)
    }
  }
  for (const [pid, window] of quiet) judgeQuiet(pid, window, until)
  return faults
}
