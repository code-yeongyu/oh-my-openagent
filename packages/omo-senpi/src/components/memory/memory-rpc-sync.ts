// The `sync` field of the `omo.memory.status` snapshot (#10637): the same failure state the TUI
// footer reads, so the desktop shows what the TUI shows. Omitted while this device does not sync the
// repository (sync off, signed out, or another process holds the engine), and when the read fails.

import type { SyncFailureKind } from "@oh-my-opencode/memory-core/sync-engine"

import type { SyncStatusReader } from "./sync-status-surface"

export interface MemoryRpcSync {
  readonly state: "never_synced" | "synced" | "paused" | "failing" | "unavailable"
  readonly lastSyncedAtISO?: string
  readonly failure?: {
    readonly kind: SyncFailureKind
    readonly reason: string
    readonly action: string
    readonly sinceISO: string
    readonly attempts: number
    readonly paths?: readonly string[]
  }
}

export async function readMemoryRpcSync(read: SyncStatusReader | undefined, repo: string): Promise<MemoryRpcSync | undefined> {
  if (read === undefined) return undefined
  const status = await read(repo).catch(() => null)
  if (status === null) return undefined
  switch (status.kind) {
    case "never_synced":
    case "paused":
      return { state: status.kind }
    case "synced":
      return { state: "synced", lastSyncedAtISO: new Date(status.at).toISOString() }
    case "sync-unavailable":
    // An invalid sync configuration (#10860) also means this device does not sync; the runner logs which variable.
    case "sync-config-invalid":
      return { state: "unavailable" }
    case "failing": {
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
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}
