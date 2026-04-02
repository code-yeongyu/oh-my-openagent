import { COMPACTION_GUARD_MS } from "./constants"
import type { SessionState } from "./types"

export function armCompactionGuard(state: SessionState, now: number): number {
  const nextEpoch = (state.recentCompactionEpoch ?? 0) + 1

  state.recentCompactionAt = now
  state.recentCompactionEpoch = nextEpoch

  return nextEpoch
}

export function acknowledgeCompactionGuard(
  state: SessionState,
  compactionEpoch: number | undefined
): boolean {
  if (compactionEpoch === undefined) {
    return false
  }

  if (state.recentCompactionEpoch !== compactionEpoch) {
    return false
  }

  state.acknowledgedCompactionEpoch = compactionEpoch
  return true
}

export function isCompactionGuardActive(state: SessionState, now: number): boolean {
  if (state.recentCompactionAt === undefined || state.recentCompactionEpoch === undefined) {
    return false
  }

  if (state.acknowledgedCompactionEpoch === state.recentCompactionEpoch) {
    return false
  }

  return now - state.recentCompactionAt < COMPACTION_GUARD_MS
}
