export function buildRejectedCompactionEvent(): Record<string, unknown> {
  return {
    type: "session_compact",
    reason: "threshold",
    requestId: "req-6871-deadlock",
    accepted: false,
    rejectionCause: "cancelled-by-extension",
    compactionEntry: undefined,
    fromExtension: false,
    willRetry: false,
  }
}
