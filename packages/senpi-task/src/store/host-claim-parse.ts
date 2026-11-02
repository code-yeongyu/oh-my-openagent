import type { HostClaim } from "../state/record-types"

// Advisory ownership evidence: a malformed stamp only loses the evidence, never the record.
export function parseOptionalHostClaim(record: Record<string, unknown>): HostClaim | undefined {
  const value = record["host_claim"]
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const { pid, at, start } = value as Record<string, unknown>
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return undefined
  if (typeof at !== "string" || !Number.isFinite(Date.parse(at))) return undefined
  return typeof start === "string" && start.length > 0 ? { pid, at, start } : { pid, at }
}
