import type { ApproveOutcome } from "@oh-my-opencode/memory-core/sync-engine"

import type { MemoryRpcSync } from "./memory-rpc-sync"

export type SyncEnableRequest = Readonly<Record<string, never>>
export type SyncPendingRequest = Readonly<Record<string, never>>
export type SyncStatusRequest = Readonly<Record<string, never>>
export type SyncDevicesRequest = Readonly<Record<string, never>>
export type PendingId = string
export type PairingCode = string

/** Why sync authority is unavailable: machine-readable, so a field report names its cause (#13153). */
export type SyncUnavailableCode =
  | "no_account"
  | "account_aborted"
  | "account_not_current"
  | "status_read_failed"
  | "operation_failed"
  | "close_failed"
  | "release_failed"
  | "handler_failed"
  | "retired"

export type SyncRpcProblem =
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string; readonly code?: SyncUnavailableCode }

export interface JoinProgress {
  readonly pendingId: PendingId
  readonly expiresAt: number
  readonly code: PairingCode | null
}

/**
 * `rootChanged`: the ceremony pinned a different memory root than this device held before its keys
 * were discarded (#12280): a notice the desktop shows, never a refusal. `rootCheck`: the device pinned,
 * but its retired pins could not be read, so whether the root changed is unknown (#12382); `reason` is
 * an errno-shaped code. Both are additive optional fields on the wire, never a new `kind`.
 */
export interface SyncRootNotice {
  readonly rootChanged?: true
  readonly rootCheck?: { readonly kind: "skipped"; readonly reason: string }
}

export type SyncEnableResponse =
  | ({ readonly kind: "joined" } & SyncRootNotice)
  | ({ readonly kind: "first_device_created" } & SyncRootNotice)
  | { readonly kind: "needs_first_device" }
  | { readonly kind: "join_required"; readonly pairing: JoinProgress }
  | { readonly kind: "expired" }
  | SyncRpcProblem

export interface PendingDeviceApproval {
  readonly id: PendingId
  readonly expiresAt: number
  readonly answered: boolean
  readonly revealed: boolean
}

export type SyncPendingResponse = { readonly pending: readonly PendingDeviceApproval[] } | SyncRpcProblem

export type SyncApproveRequest =
  | { readonly action: "begin"; readonly pendingId: PendingId }
  | { readonly action: "confirm"; readonly pendingId: PendingId; readonly code: PairingCode }
  | { readonly action: "decline"; readonly pendingId: PendingId }

export interface ApprovalProgress {
  readonly pendingId: PendingId
  readonly expiresAt: number
  readonly code: PairingCode | null
  readonly outcome: ApproveOutcome | null
}

export type SyncApproveResponse = ApprovalProgress | SyncRpcProblem

export type SyncStatusResponse =
  | {
      readonly sync?: MemoryRpcSync
      readonly enable: SyncEnableResponse | null
      readonly approvals: readonly ApprovalProgress[]
    }
  | SyncRpcProblem

export interface SyncDevice {
  readonly id: string
  readonly name: string
  readonly kind: "desktop" | "cli"
  readonly platform: "macos" | "linux" | "windows"
  readonly createdAt: string
  readonly lastSeenAt: string
  readonly approximateLocation?: string
  readonly current: boolean
  readonly syncing: boolean
  readonly revokedAt: string | null
  readonly syncPrincipal: string | null
}

export type SyncDevicesResponse = { readonly devices: readonly SyncDevice[] } | SyncRpcProblem
