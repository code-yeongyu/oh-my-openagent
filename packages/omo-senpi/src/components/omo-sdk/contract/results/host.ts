import type { WarmAnswer } from "../../../../../../senpi-task/src/runners/rpc-host/host-warm-reply"
import type { JsonObject } from "../../../remote/types"
import type { ConfigStatus } from "../../config"

// What the daemon, diagnostics and install calls answer as their `value`. A record the engine's host command prints is
// a JSON object here: its own type is exported by the engine in slice E1a. Every other record is the one the `omo` verb
// prints today with --json, or the finding list a prose verb reports as lines.
export type { ConfigStatus, WarmAnswer }

type HostReply = JsonObject & { readonly action: string }

/** A refused or failed warm is reported here and the run still succeeds (design 6.7). */
export type DaemonRun = { readonly ensure: HostReply; readonly warm: WarmAnswer }
export type DaemonEnsure = HostReply
export type DaemonStatus = { readonly endpoints: readonly JsonObject[]; readonly aggregate: JsonObject }
export type DaemonStop = HostReply
export type DaemonStopAll = {
  readonly endpoints: readonly {
    readonly socket: string
    readonly outcome: "requested" | "drained" | "already_drained" | "refused" | "timeout"
    readonly polls?: number
    readonly summary?: string
  }[]
}
export type DaemonHandoff = { readonly endpoints: readonly { readonly socket: string; readonly action: string }[] }
export type DaemonGc = {
  readonly removed: readonly JsonObject[]
  readonly kept: readonly JsonObject[]
  readonly reaped_meta: readonly string[]
  readonly pruned_stores: readonly string[]
}
export type DaemonRollbackPrepare = {
  readonly dry_run: boolean
  readonly stores: readonly JsonObject[]
  readonly coverage: {
    readonly discovered: number
    readonly from_index: number
    readonly from_sidecars: number
    readonly from_store: number
    readonly missing: readonly string[]
    readonly endpoints_without_store_map: readonly string[]
  }
}
export type DaemonShardPath = { readonly path: string }

/** One line of a doctor report as data: its level, the check it belongs to and what it says. */
export type Finding = {
  readonly level: "ok" | "notice" | "warn" | "fail"
  readonly check: string
  readonly message: string
}
export type Diagnostics = { readonly findings: readonly Finding[] }
export type FixReflectionLock = { readonly dry_run: boolean; readonly findings: readonly Finding[] }
export type ReapStaleEngines = {
  readonly engines: readonly {
    readonly pid: number
    readonly outcome: "reaped" | "refused" | "not_found"
    readonly reason?: string
  }[]
}

export type { SetupInventory, SetupPlan } from "../inputs/host"
export type SetupApplied = { readonly applied: readonly string[]; readonly skipped: readonly string[] }
export type InstallUpdate = { readonly version: string; readonly command: readonly string[]; readonly ran: boolean }
export type InstallVersion = { readonly version: string }
export type SdkRoot = { readonly path: string }
