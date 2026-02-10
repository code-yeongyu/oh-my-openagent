export function pruneRecentSyntheticIdles(args: {
  recentSyntheticIdles: Map<string, number>
  now: number
  dedupWindowMs: number
}): void {
  const { recentSyntheticIdles, now, dedupWindowMs } = args

  for (const [sessionID, emittedAt] of recentSyntheticIdles) {
    if (now - emittedAt >= dedupWindowMs) {
      recentSyntheticIdles.delete(sessionID)
    }
  }
}
