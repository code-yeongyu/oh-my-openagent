import type { SentinelEvent } from "./events.ts"
import { formatSignals, type SentinelSummary, summarize, type Verdict, verdict } from "./summary.ts"

type Recording = { segment(act: () => Promise<void>, windowMs: number): Promise<SentinelEvent[]> }

type SentinelRun<T> = { readonly result: T; readonly summary: SentinelSummary; readonly verdict: Verdict }

// Runs one scenario under the sentinel: the synthetic user keeps typing, the recorder watches all eight signals, and
// the run passes only when the scenario's own oracle holds and every signal reads none. The caller has already
// admitted `windowMs` against the host's recorded latency (latency.ts); a window chosen here would be a guess.
export async function withSentinel<T>(
  scenario: string,
  fn: () => Promise<T>,
  options: { readonly session: Recording; readonly windowMs: number },
): Promise<SentinelRun<T>> {
  let result: { readonly value: T } | undefined
  const events = await options.session.segment(async () => {
    result = { value: await fn() }
  }, options.windowMs)
  if (result === undefined) throw new Error(`sentinel: scenario ${scenario} never completed`)
  const summary = summarize(events)
  const judged = verdict(summary)
  console.log(`SENTINEL ${scenario} verdict=${judged} ${formatSignals(summary)}`)
  return { result: result.value, summary, verdict: judged }
}
