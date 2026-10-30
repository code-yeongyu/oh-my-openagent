const NUMBER_PROPERTY = Object.freeze({ type: "number" } as const)
const STRING_PROPERTY = Object.freeze({ type: "string" } as const)

function enumProperty<const Values extends readonly string[]>(values: Values): Readonly<{
  type: "string"
  values: Values
}> {
  return Object.freeze({ type: "string", values: Object.freeze(values) })
}

export const PROCESS_KINDS = ["interactive", "print", "json", "rpc-host", "task-child", "unknown"] as const
export const CRASH_DETECTIONS = ["supervisor", "parent", "unclean_exit", "unknown"] as const
export const CRASH_SIGNALS = [
  "SIGSEGV", "SIGBUS", "SIGILL", "SIGTRAP", "SIGABRT", "SIGFPE", "SIGKILL", "SIGTERM", "SIGHUP", "SIGINT",
  "SIGQUIT", "SIGSYS", "other", "none", "unknown",
] as const
export const UPTIME_BUCKETS = ["lt_1m", "1_10m", "10_60m", "1_6h", "6_24h", "24h_plus"] as const
/**
 * Which kind of RPC host crashed: a per-parent-session shard (`p`), a Desktop per-thread shard (`i`),
 * the legacy machine-wide endpoint or no host at all (`none`), or an endpoint directory that names no
 * socket of its own (`unknown`). Never the shard key, the socket or the owner id.
 */
export const SHARD_KINDS = ["p", "i", "none", "unknown"] as const
export type CrashShardKind = (typeof SHARD_KINDS)[number]

/**
 * Privacy schema for `process_crashed`: how a process died and on which runtime, nothing else. No
 * stack, path, prompt or session id ever reaches it; the crash-time versions are version-shaped
 * strings or `unknown`.
 */
export const PROCESS_CRASHED_SCHEMA = Object.freeze({
  "$os": STRING_PROPERTY,
  arch: STRING_PROPERTY,
  crashed_bun_version: STRING_PROPERTY,
  crashed_engine_version: STRING_PROPERTY,
  crashed_omo_version: STRING_PROPERTY,
  detection: enumProperty(CRASH_DETECTIONS),
  exit_code: NUMBER_PROPERTY,
  process_kind: enumProperty(PROCESS_KINDS),
  shard_kind: enumProperty(SHARD_KINDS),
  signal: enumProperty(CRASH_SIGNALS),
  uptime_bucket: enumProperty(UPTIME_BUCKETS),
  uptime_ms: NUMBER_PROPERTY,
})
