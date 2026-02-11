export function pruneRecentSyntheticIdles(args: {
  recentSyntheticIdles: Map<string, number>
  recentRealIdles: Map<string, number>
  now: number
  dedupWindowMs: number
}): void {
  const { recentSyntheticIdles, recentRealIdles, now, dedupWindowMs } = args

  for (const [sessionID, emittedAt] of recentSyntheticIdles) {
    if (now - emittedAt >= dedupWindowMs) {
      recentSyntheticIdles.delete(sessionID)
    }
  }

  for (const [sessionID, emittedAt] of recentRealIdles) {
    if (now - emittedAt >= dedupWindowMs) {
      recentRealIdles.delete(sessionID)
    }
  }
}
