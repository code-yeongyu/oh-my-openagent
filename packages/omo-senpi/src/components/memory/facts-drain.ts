// Post-success drain for the byte-capped facts pipeline.
//
// WHY: the payload cap (T10) turns one settle's backlog into N runs. The settle debounce gates
// when a drain STARTS, not each split window - without this loop a legacy backlog would need
// one debounce cycle per capped batch to clear, which is exactly how a backlog becomes
// permanent. So after every SUCCESSFUL outcome the next launch is attempted immediately, until
// selection reports nothing launchable.
//
// A FAILURE STOPS THE DRAIN: pacing after a failure belongs to the backoff/park contract (T4-T6),
// never to this loop. `active`/`skipped` stop it too - another owner holds the work, or the
// launch refused itself (fail-closed ledger, parked selection), and retrying in-loop would spin.

import type { FactsLaunchResult } from "./facts-runner-types"

/** Outcomes after which more work may still be launchable right now. */
function drainsOn(result: FactsLaunchResult): boolean {
  return result.status === "committed" || result.status === "no_facts"
}

/**
 * Repeats `attempt` while it keeps succeeding. The FIRST attempt's outcome is returned: that is
 * the run this call produced, and callers (status surfaces, shutdown drain, `/facts retry`)
 * report on it. Continuation batches are a side effect of the same latch-held drain.
 */
export async function drainFactsLaunches(
  attempt: () => Promise<FactsLaunchResult>,
  signal?: AbortSignal,
): Promise<FactsLaunchResult> {
  const first = await attempt()
  let latest = first
  while (drainsOn(latest) && signal?.aborted !== true) {
    latest = await attempt()
  }
  return first
}
