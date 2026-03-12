import { COMPACTION_GUARD_MS } from "./constants"
import type { SessionState } from "./types"

export function isCompactionGuardActive(state: SessionState, now: number): boolean {
  if (!state.recentCompactionAt) {
    return false
  }

  return now - state.recentCompactionAt < COMPACTION_GUARD_MS
}
