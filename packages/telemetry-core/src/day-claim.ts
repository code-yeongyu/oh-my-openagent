import { closeSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

const CLAIM_PREFIX = "daily-active."
const CLAIM_SUFFIX = ".claim"

export type DayClaimOutcome = "claimed" | "already-claimed" | "unavailable"

export function getTelemetryDayClaimFilePath(stateDir: string, dayUTC: string): string {
  return join(stateDir, `${CLAIM_PREFIX}${dayUTC}${CLAIM_SUFFIX}`)
}

/**
 * Exclusive-create is what makes the daily-active decision safe: the `wx` flag fails with EEXIST
 * when another process already owns the day, so exactly one caller of a fresh day is told to
 * capture no matter how many start at once. Anything else - a read-then-write, or a write whose
 * failure is ignored - degrades to one event per launch on the machines where it matters.
 */
export function claimUtcDay(stateDir: string, dayUTC: string): DayClaimOutcome {
  try {
    mkdirSync(stateDir, { recursive: true })
    closeSync(openSync(getTelemetryDayClaimFilePath(stateDir, dayUTC), "wx"))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EEXIST" ? "already-claimed" : "unavailable"
  }

  pruneSupersededClaims(stateDir, dayUTC)
  return "claimed"
}

function pruneSupersededClaims(stateDir: string, dayUTC: string): void {
  const currentClaim = `${CLAIM_PREFIX}${dayUTC}${CLAIM_SUFFIX}`
  let entries: readonly string[]
  try {
    entries = readdirSync(stateDir)
  } catch {
    // Housekeeping only: the day is already claimed, so a failure here must not change the decision.
    return
  }

  for (const entry of entries) {
    if (entry === currentClaim) continue
    if (!entry.startsWith(CLAIM_PREFIX) || !entry.endsWith(CLAIM_SUFFIX)) continue
    try {
      rmSync(join(stateDir, entry), { force: true })
    } catch {
      // A claim left behind costs one stale file, never a duplicate event.
    }
  }
}
