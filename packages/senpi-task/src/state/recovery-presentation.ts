import { PERMANENT_REVIVAL_REASONS } from "../lifecycle/deferred-revival-reasons"

const CAUSES: Readonly<Record<string, string>> = {
  daemon_unavailable: "task daemon unavailable",
  own_host_unreachable: "host lost",
  host_incompatible: "host version mismatch",
  revival_deferred: "revival deferred",
  idle_evicted: "evicted while idle",
  handoff_parked: "handed off",
  host_draining: "host draining",
  store_index_unavailable: "task store unavailable",
}

export function recoveryPresentation(record: {
  readonly status: string
  readonly residency_state?: string
  readonly suspension_reason?: string
  readonly revival_deferred_reason?: string
  readonly failure_kind?: string
  readonly error_message?: string
}): { readonly state: "resuming" | "ending"; readonly cause: string; readonly text: string } | undefined {
  if (["completed", "error", "cancelled", "lost"].includes(record.status)) return undefined
  const expiring = record.failure_kind === "suspended_unresumable"
    || record.error_message?.startsWith("suspended_unresumable:") === true
  if (!expiring && record.suspension_reason === undefined
    && (record.residency_state === undefined || record.residency_state === "resident")) return undefined
  const reason = record.revival_deferred_reason ?? record.suspension_reason ?? ""
  const state = expiring || PERMANENT_REVIVAL_REASONS.has(reason) ? "ending" : "resuming"
  const cause = (record.revival_deferred_reason === undefined ? undefined
    : record.suspension_reason === "revival_deferred" ? `revival deferred: ${record.revival_deferred_reason}` : record.revival_deferred_reason)
    ?? (record.suspension_reason === undefined ? "parent session restarted" : CAUSES[record.suspension_reason] ?? record.suspension_reason)
  return { state, cause, text: `${state} (${cause})` }
}
