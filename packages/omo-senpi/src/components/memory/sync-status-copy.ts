// The desktop snapshot of a failing or frozen engine, and what a person is told about a freeze (rotation
// on revoke, #12280: the engine reports a closed code; the words live here). It ships in the sync
// sidecar: both statuses exist only while the engine runs, so the eager bundle carries none of it.

import type { EngineStatus } from "@oh-my-opencode/memory-core/sync-engine"

import type { MemoryRpcSync } from "./memory-rpc-sync"

type Frozen = Extract<EngineStatus, { readonly kind: "frozen" }>
type Failing = Extract<EngineStatus, { readonly kind: "failing" }>

const ACTION: Partial<Record<Frozen["reason"], string>> = {
  waiting_recovery: "Run recovery again on this device.",
  waiting_unsupported_freeze: "Update OmO on this device.",
  self_revoked: "Sign in again on this device.",
  no_epoch_key: "Approve this device again from a device that syncs.",
}

/** The TUI notice's failure: a kind per code (each code is its own notice), a reason and an action. */
export function freezeFailure(status: Frozen): { readonly kind: string; readonly reason: string; readonly action: string } {
  return {
    kind: `frozen:${status.reason}`,
    reason: `Memory sync is paused until the memory key changes after a device was removed (${status.reason}).`,
    action: ACTION[status.reason] ?? "Sync resumes on its own.",
  }
}

/**
 * The desktop snapshot. Its schema accepts only the current literals, so a freeze is a failure of the
 * "unknown" kind.
 */
export function failureRpcSync(status: Failing | Frozen): MemoryRpcSync {
  if (status.kind === "frozen") {
    const { reason, action } = freezeFailure(status)
    return { state: "failing", failure: { kind: "unknown", reason, action, sinceISO: new Date(status.since).toISOString(), attempts: 1 } }
  }
  const { failure } = status
  return {
    state: "failing",
    failure: {
      kind: failure.kind,
      reason: failure.reason,
      action: failure.action,
      sinceISO: new Date(status.since).toISOString(),
      attempts: status.attempts,
      ...(failure.kind === "stranded_lock" ? { paths: failure.paths } : {}),
    },
  }
}
