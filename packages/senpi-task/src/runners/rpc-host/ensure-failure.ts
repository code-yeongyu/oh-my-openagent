export type EnsureFailureReason = "ensure_failed" | "ensure_timed_out" | "protocol" | "capability" | "legacy_host" | "host_busy"

const INCOMPATIBLE_REFUSALS: ReadonlySet<string> = new Set(["protocol", "capability", "legacy_host"])

export function classifyEnsureFailure(error: unknown): EnsureFailureReason {
  if (error instanceof Error) {
    if (error.name === "HostEnsureRefusedError") {
      return "reason" in error && error.reason === "host_busy" ? "host_busy" : incompatibleRefusal(error) ?? "ensure_failed"
    }
    const code = "code" in error && typeof error.code === "string" ? error.code : undefined
    if (code === "SQLITE_BUSY" || code === "ETIMEDOUT") return "ensure_timed_out"
    if (isDaemonReadinessTimeout(error.message)) return "ensure_timed_out"
  }
  return "ensure_failed"
}

// The engine names WHY it refused (senpi `HostEnsureRefusedError.reason`); an incompatible endpoint
// must stay distinguishable from one that merely failed to start.
function incompatibleRefusal(error: Error): "protocol" | "capability" | "legacy_host" | undefined {
  const reason = "reason" in error ? error.reason : undefined
  if (typeof reason !== "string" || !INCOMPATIBLE_REFUSALS.has(reason)) return undefined
  return reason as "protocol" | "capability" | "legacy_host"
}

function isDaemonReadinessTimeout(message: string): boolean {
  return /^spawned RPC socket host did not answer get_protocol_info within \d+ms(?: \(teardown also reported:[^\r\n]*\))?(?:\r?\n|$)/.test(
    message,
  )
}
