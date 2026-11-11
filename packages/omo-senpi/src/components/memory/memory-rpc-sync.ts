// The `sync` field of the `omo.memory.status` snapshot (#10637): the same failure state the TUI
// footer reads, so the desktop shows what the TUI shows. Omitted while this device does not sync the
// repository (sync off, signed out, or another process holds the engine), and when the read fails.

import type { SyncFailureKind } from "@oh-my-opencode/memory-core/sync-engine"

import type { SyncStatusReader } from "./sync-status-surface"

/** The failure kinds the desktop's status schema accepts (omo-desktop-app contracts); any other kind fails its whole status call. */
type DesktopFailureKind = Exclude<SyncFailureKind, "oversized_item">

export interface MemoryRpcSync {
  readonly state: "never_synced" | "synced" | "paused" | "failing" | "unavailable"
  readonly lastSyncedAtISO?: string
  /** For `failing`, and for `paused` while files are held out of the push too (#12284). */
  readonly failure?: {
    readonly kind: DesktopFailureKind
    readonly reason: string
    readonly action: string
    readonly sinceISO: string
    readonly attempts: number
    readonly paths?: readonly string[]
    /** A held file (#12284, shown as "unknown"): every held file, the ones shrinking will not fix, and the size limit. */
    readonly keys?: readonly string[]
    readonly stuckKeys?: readonly string[]
    readonly limitBytes?: number
  }
}

export async function readMemoryRpcSync(
  read: SyncStatusReader | undefined,
  repo: string,
): Promise<MemoryRpcSync | undefined> {
  if (read === undefined) return undefined
  const status = await read(repo).catch(() => null)
  if (status === null) return undefined
  switch (status.kind) {
    case "never_synced":
      return { state: status.kind }
    case "paused":
      // A pause that carries held files (#12284) exists only while the engine runs too, so its mapping ships with it.
      return status.held === undefined
        ? { state: "paused" }
        : (await import("#omo-memory-sync-runtime")).failureRpcSync(status)
    case "synced":
      return { state: "synced", lastSyncedAtISO: new Date(status.at).toISOString() }
    // Both exist only while the engine runs, so their mapping ships with it (sync-status-copy.ts).
    case "failing":
    case "frozen":
      return (await import("#omo-memory-sync-runtime")).failureRpcSync(status)
    case "sync-unavailable":
    // An invalid sync configuration (#10860) also means this device does not sync; the runner logs which variable.
    case "sync-config-invalid":
      return { state: "unavailable" }
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}
