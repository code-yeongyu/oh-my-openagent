// The push half of one cycle, with the service freeze settled (sync-design section 6, the stale-base
// rule, and section 7, rotation on revoke). A push refused `stale_base` asks the account session's
// settler first: while a rotation is pending the device rotates or waits instead of retrying, and the
// freeze is reported as a status instead of a silent `pushed: false`. A settle can also run before
// the first push (a startup or poll cycle, a state event, or a stream event while frozen), so a device
// with nothing to push still ends a freeze.

import type { EngineDeps } from "./engine-deps"
import type { SyncJournal } from "./journal"
import type { FreezeOutcome, FreezeReason } from "./ports"
import { push, staleBackoffMs } from "./push"

const PUSH_ATTEMPTS = 3

export interface Frozen {
  readonly reason: FreezeReason
  readonly since: number
}

export interface PushCycleInput {
  readonly deps: EngineDeps
  readonly journal: SyncJournal
  /** Receive and apply; after a rotation it moves the applied cursor past the keyring row. */
  readonly inbound: () => Promise<void>
  readonly sleep: (ms: number) => Promise<void>
  readonly settleFirst: boolean
  readonly frozen: Frozen | null
}

export interface PushCycleResult {
  readonly pushed: boolean
  readonly frozen: Frozen | null
}

const ended = (outcome: FreezeOutcome | null): boolean => outcome?.kind === "rotated" || outcome?.kind === "adopted"

export async function pushCycle(input: PushCycleInput): Promise<PushCycleResult> {
  const { deps, journal } = input
  let frozen = input.frozen
  const settle = async (): Promise<FreezeOutcome | null> => {
    if (deps.freeze === undefined) return null
    const outcome = await deps.freeze.settle()
    frozen = outcome.kind === "frozen" ? { reason: outcome.reason, since: frozen?.since ?? deps.clock.now() } : null
    return outcome
  }
  if (input.settleFirst && ended(await settle())) await input.inbound()
  for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt += 1) {
    const outcome = await push(deps, journal, deps.batchBytes)
    if (outcome !== "stale") {
      if (outcome === "pushed") frozen = null
      return { pushed: outcome === "pushed", frozen }
    }
    const settled = await settle()
    if (settled?.kind === "frozen") return { pushed: false, frozen }
    if (!ended(settled)) await input.sleep(staleBackoffMs(attempt, deps.random))
    await input.inbound()
  }
  return { pushed: false, frozen }
}
