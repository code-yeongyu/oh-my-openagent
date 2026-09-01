// Read-only rendering of the facts failure ledger for `/facts`, `/doctor`, and the advisory line.
//
// FAIL-CLOSED SURFACING: an unreadable `failures.json` is rendered as CORRUPT, never as zeros.
// Zeros would tell the user the pipeline is healthy while every launch is actually refused.

import {
  FactsFailuresCorruptError,
  FactsFailureStore,
  factsQueuePaths,
  type FactsFailureRecord,
  type MemoryIdentityPaths,
} from "@oh-my-opencode/memory-core"
import { readdir } from "@oh-my-opencode/memory-core/fs"

/** How many failing conversations the status view lists, newest failure first. */
const MAX_LISTED_CONVERSATIONS = 5
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

export interface FactsOverview {
  readonly pending: number
  readonly records: readonly FactsFailureRecord[]
  readonly now: Date
  /** Present only when the ledger could not be parsed; counts are meaningless then. */
  readonly corrupt?: string
}

function parked(state: FactsOverview): readonly FactsFailureRecord[] {
  return state.records.filter((record) => record.state === "parked")
}

function backoff(state: FactsOverview): readonly FactsFailureRecord[] {
  return state.records.filter((record) => record.state === "backoff")
}

/** Earliest eligibility instant among backoff records, in ms from now (never negative). */
function nextEligibleMs(state: FactsOverview): number | undefined {
  const instants = backoff(state)
    .map((record) => (record.nextEligibleAt === null ? Number.NaN : Date.parse(record.nextEligibleAt)))
    .filter((value) => Number.isFinite(value))
  if (instants.length === 0) return undefined
  return Math.max(0, Math.min(...instants) - state.now.getTime())
}

function formatWait(deltaMs: number): string {
  if (deltaMs < MINUTE_MS) return "now"
  if (deltaMs < HOUR_MS) return `${Math.round(deltaMs / MINUTE_MS)}m`
  return `${Math.round(deltaMs / HOUR_MS)}h`
}

function firstLine(detail: string | undefined): string | undefined {
  const line = detail?.split("\n")[0]?.trim()
  return line === undefined || line.length === 0 ? undefined : line
}

/** One bounded advisory line, or nothing when the ledger is clean. */
export function formatFactsAdvisory(state: FactsOverview): string | undefined {
  if (state.corrupt !== undefined) return "facts: failure ledger unreadable (run /facts for detail)"
  const parkedCount = parked(state).length
  const backoffCount = backoff(state).length
  if (parkedCount === 0 && backoffCount === 0) return undefined
  const wait = nextEligibleMs(state)
  const suffix = wait === undefined ? "" : ` (next ${formatWait(wait)})`
  return `facts: ${parkedCount} parked / ${backoffCount} backoff${suffix}`
}

/** Advisory remediation: parked state names the one manual remedy, `/facts retry`. */
export function factsRemediationHint(state: FactsOverview): string | undefined {
  if (state.corrupt !== undefined) {
    return `facts failure ledger is unreadable (${state.corrupt}); repair or delete failures.json to resume launches`
  }
  const parkedCount = parked(state).length
  if (parkedCount > 0) {
    return `${parkedCount} parked facts batch${parkedCount === 1 ? "" : "es"} need${parkedCount === 1 ? "s" : ""} a manual unpark; run /facts retry after fixing the cause`
  }
  const backoffCount = backoff(state).length
  if (backoffCount === 0) return undefined
  const wait = nextEligibleMs(state)
  return `${backoffCount} facts batch${backoffCount === 1 ? " is" : "es are"} backing off${wait === undefined ? "" : `; next attempt in ${formatWait(wait)}`}`
}

/** The full read-only `/facts` view. Never enters model context; callers notify + return it. */
export function formatFactsStatus(identity: string, state: FactsOverview): string {
  const lines = [`# Facts pipeline: ${identity}`, "", `queued: ${state.pending} pending`]
  if (state.corrupt !== undefined) {
    lines.push(
      "",
      `failure ledger is UNREADABLE: ${state.corrupt}`,
      "launches are blocked until failures.json is repaired or removed (fail-closed by design)",
    )
    return lines.join("\n")
  }

  const parkedRecords = parked(state)
  const backoffRecords = backoff(state)
  if (parkedRecords.length === 0 && backoffRecords.length === 0) {
    lines.push("no failing batches")
    return lines.join("\n")
  }

  const wait = nextEligibleMs(state)
  lines.push(
    `parked: ${parkedRecords.length}`,
    `backoff: ${backoffRecords.length}${wait === undefined ? "" : ` (next eligible ${formatWait(wait)})`}`,
    "",
  )
  const newestFirst = [...state.records].sort(
    (left, right) => Date.parse(right.lastFailureAt) - Date.parse(left.lastFailureAt),
  )
  for (const record of newestFirst.slice(0, MAX_LISTED_CONVERSATIONS)) {
    const detail = firstLine(record.lastDetail)
    lines.push(
      `- ${record.conversationId}: ${record.state} after ${record.streak} (${record.lastReason})${detail === undefined ? "" : ` - ${detail}`}`,
    )
  }
  if (newestFirst.length > MAX_LISTED_CONVERSATIONS) {
    lines.push(`... and ${newestFirst.length - MAX_LISTED_CONVERSATIONS} more`)
  }
  lines.push("", "Unpark: /facts retry [--conversation <id>]")
  return lines.join("\n")
}

/** Counts retained queue files; `consumed.json`/`failures.json` are state, not batches. */
async function countPending(queueDir: string): Promise<number> {
  try {
    const names = await readdir(queueDir)
    return names.filter(
      (name) => name.endsWith(".json") && name !== "consumed.json" && name !== "failures.json",
    ).length
  } catch {
    return 0
  }
}

export interface ReadFactsOverviewInput {
  readonly identityPaths: MemoryIdentityPaths
  readonly now: Date
}

/** Reads the durable ledger + queue depth. A corrupt ledger becomes `corrupt`, not zeros. */
export async function readFactsOverview(input: ReadFactsOverviewInput): Promise<FactsOverview> {
  const layout = factsQueuePaths(input.identityPaths)
  const pending = await countPending(layout.queueDir)
  const store = new FactsFailureStore({ identityPaths: input.identityPaths, now: () => input.now })
  try {
    const failures = await store.readFailures()
    return { pending, records: failures.entries, now: input.now }
  } catch (error) {
    const corrupt = error instanceof FactsFailuresCorruptError
      ? error.message
      : `failure ledger unreadable: ${error instanceof Error ? error.message : String(error)}`
    return { pending, records: [], now: input.now, corrupt }
  }
}
