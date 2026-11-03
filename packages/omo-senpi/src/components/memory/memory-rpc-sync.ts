// The `sync` field of the `omo.memory.status` snapshot (#10637): the same failure state the TUI
// footer reads, so the desktop shows what the TUI shows. Omitted while this device does not sync the
// repository (sync off, signed out, or another process holds the engine), and when the read fails.

import type { Failing, SyncFailureKind } from "@oh-my-opencode/memory-core/sync-engine"

import type { SyncStatusReader } from "./sync-status-surface"

export interface MemoryRpcSync {
  readonly state: "never_synced" | "synced" | "paused" | "failing" | "unavailable"
  readonly lastSyncedAtISO?: string
  /** For `failing`, and for `paused` while files are held out of the push too (#12284). */
  readonly failure?: {
    readonly kind: SyncFailureKind
    readonly reason: string
    readonly action: string
    readonly sinceISO: string
    readonly attempts: number
    readonly paths?: readonly string[]
    /** `oversized_item`: every held file, the ones shrinking will not fix, and the size limit. */
    readonly keys?: readonly string[]
    readonly stuckKeys?: readonly string[]
    readonly limitBytes?: number
  }
}

function rpcFailure({ failure, since, attempts }: Failing): NonNullable<MemoryRpcSync["failure"]> {
  return {
    kind: failure.kind,
    reason: failure.reason,
    action: failure.action,
    sinceISO: new Date(since).toISOString(),
    attempts,
    ...(failure.kind === "stranded_lock" ? { paths: failure.paths } : {}),
    ...(failure.kind === "oversized_item" ? { keys: failure.keys, stuckKeys: failure.stuck, limitBytes: failure.limitBytes } : {}),
  }
}

export async function readMemoryRpcSync(read: SyncStatusReader | undefined, repo: string): Promise<MemoryRpcSync | undefined> {
  if (read === undefined) return undefined
  const status = await read(repo).catch(() => null)
  if (status === null) return undefined
  switch (status.kind) {
    case "never_synced":
      return { state: status.kind }
    case "paused":
      return status.held === undefined ? { state: "paused" } : { state: "paused", failure: rpcFailure(status.held) }
    case "synced":
      return { state: "synced", lastSyncedAtISO: new Date(status.at).toISOString() }
    case "sync-unavailable":
    // An invalid sync configuration (#10860) also means this device does not sync; the runner logs which variable.
    case "sync-config-invalid":
      return { state: "unavailable" }
    case "failing":
      return { state: "failing", failure: rpcFailure(status) }
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}
