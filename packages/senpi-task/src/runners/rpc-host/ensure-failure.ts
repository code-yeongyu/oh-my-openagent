export type EnsureFailureReason = "ensure_failed" | "ensure_timed_out"

export function classifyEnsureFailure(error: unknown): EnsureFailureReason {
  if (error instanceof Error) {
    if (error.name === "HostEnsureRefusedError") return "ensure_failed"
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined
    if (code === "SQLITE_BUSY" || code === "ETIMEDOUT") return "ensure_timed_out"
    if (isDaemonReadinessTimeout(error.message)) return "ensure_timed_out"
  }
  return "ensure_failed"
}

function isDaemonReadinessTimeout(message: string): boolean {
  return /^spawned RPC socket host did not answer get_protocol_info within \d+ms(?: \(teardown also reported:[^\r\n]*\))?(?:\r?\n|$)/.test(
    message,
  )
}
