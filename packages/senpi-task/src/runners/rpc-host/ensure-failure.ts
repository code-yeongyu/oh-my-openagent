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

// senpi refuses an `owner: "caller"` claim on a host it cannot hand to this caller with a plain
// `Error` (senpi 2026.10.10-12 `claimHostOwner` and `ensureHost`): a host started by an engine
// before owner lifetimes, a generation without a matching registration, or another owner still
// alive. The host itself is healthy, so the ensure can still attach without claiming it.
const OWNER_CLAIM_REFUSALS: ReadonlySet<string> = new Set([
  "RPC host does not support owner lifetime registration",
  "RPC host has no matching registered owner-lifetime generation",
  "RPC host lifetime owner is still alive or its identity is unknown",
])

export function isOwnerClaimRefusal(error: unknown): boolean {
  return error instanceof Error && error.name === "Error" && OWNER_CLAIM_REFUSALS.has(error.message)
}

function isDaemonReadinessTimeout(message: string): boolean {
  return /^spawned RPC socket host did not answer get_protocol_info within \d+ms(?: \(teardown also reported:[^\r\n]*\))?(?:\r?\n|$)/.test(
    message,
  )
}
