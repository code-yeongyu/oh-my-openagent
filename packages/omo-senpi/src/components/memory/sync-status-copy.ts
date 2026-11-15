// The desktop snapshot of a failing, frozen or held engine (or a pause carrying held files, #12284), and what a person is told about a freeze (rotation
// on revoke, #12280: the engine reports a closed code; the words live here). It ships in the sync
// sidecar: both statuses exist only while the engine runs, so the eager bundle carries none of it.

import type { EngineStatus } from "@oh-my-opencode/memory-core/sync-engine"

import type { MemoryRpcSync } from "./memory-rpc-sync"

type Frozen = Extract<EngineStatus, { readonly kind: "frozen" }>
type Failing = Extract<EngineStatus, { readonly kind: "failing" }>
type Paused = Extract<EngineStatus, { readonly kind: "paused" }>
type Held = Extract<EngineStatus, { readonly kind: "held" }>

const ACTION: Partial<Record<Frozen["reason"], string>> = {
  waiting_recovery: "Run recovery again on this device.",
  waiting_unsupported_freeze: "Update OmO on this device.",
  self_revoked: "Sign in again on this device.",
  no_epoch_key: "Approve this device again from a device that syncs.",
}

/** The TUI notice's failure: a kind per code (each code is its own notice), a reason and an action. */
export function freezeFailure(status: Frozen): {
  readonly kind: string
  readonly reason: string
  readonly action: string
} {
  return {
    kind: `frozen:${status.reason}`,
    reason: `Memory sync is paused until the memory key changes after a device was removed (${status.reason}).`,
    action: ACTION[status.reason] ?? "Sync resumes on its own.",
  }
}

/**
 * The desktop snapshot. Its schema accepts only the current literals, so a freeze is a failure of the "unknown"
 * kind. Held files are no failure (#12392): the state stays synced (or never synced) and an additive `held`
 * names them. A pause that carries held files keeps them as its "unknown" failure for an older desktop too.
 */
export function failureRpcSync(status: Failing | Frozen | Paused | Held): MemoryRpcSync {
  if (status.kind === "held")
    return status.at === null
      ? { state: "never_synced", held: rpcHeld(status.held) }
      : { state: "synced", lastSyncedAtISO: new Date(status.at).toISOString(), held: rpcHeld(status.held) }
  if (status.kind === "frozen") {
    const { reason, action } = freezeFailure(status)
    return {
      state: "failing",
      failure: { kind: "unknown", reason, action, sinceISO: new Date(status.since).toISOString(), attempts: 1 },
    }
  }
  if (status.kind === "paused")
    return status.held === undefined
      ? { state: "paused" }
      : { state: "paused", failure: rpcFailure(status.held), held: rpcHeld(status.held) }
  return { state: "failing", failure: rpcFailure(status) }
}

function rpcHeld({ failure, since, attempts }: Held["held"]): NonNullable<MemoryRpcSync["held"]> {
  // The engine describes every hold as an oversized item; the narrowing only satisfies the shared failure type.
  const oversized = failure.kind === "oversized_item" ? failure : { keys: [], stuck: [], limitBytes: 0 }
  return {
    keys: oversized.keys,
    stuckKeys: oversized.stuck,
    limitBytes: oversized.limitBytes,
    reason: failure.reason,
    action: failure.action,
    sinceISO: new Date(since).toISOString(),
    attempts,
  }
}

function rpcFailure({ failure, since, attempts }: Omit<Failing, "kind">): NonNullable<MemoryRpcSync["failure"]> {
  return {
    kind: failure.kind === "oversized_item" ? "unknown" : failure.kind,
    reason: failure.reason,
    action: failure.action,
    sinceISO: new Date(since).toISOString(),
    attempts,
    ...(failure.kind === "stranded_lock" ? { paths: failure.paths } : {}),
    ...(failure.kind === "oversized_item"
      ? { keys: failure.keys, stuckKeys: failure.stuck, limitBytes: failure.limitBytes }
      : {}),
  }
}
