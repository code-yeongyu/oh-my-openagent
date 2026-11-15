import type { ApproveOutcome } from "@oh-my-opencode/memory-core/sync-engine"

import type { MemoryRpcSync } from "./memory-rpc-sync"

export type SyncEnableRequest = Readonly<Record<string, never>>
export type SyncPendingRequest = Readonly<Record<string, never>>
export type SyncStatusRequest = Readonly<Record<string, never>>
export type SyncDevicesRequest = Readonly<Record<string, never>>
export type PendingId = string
export type PairingCode = string

/** Service refusals a client can act on; `refused` carries one only for these (#12123). */
export type SyncServiceCode =
  | "not_available"
  | "entitlement_required"
  | "access_not_open"
  | "device_revoked"
  | "reauth_required"
  | "account_deleted"
  | "client_update_required"

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
  | { readonly kind: "refused"; readonly reason: string; readonly code?: SyncServiceCode }
  | { readonly kind: "unavailable"; readonly reason: string; readonly code?: SyncUnavailableCode }

export interface JoinProgress {
  readonly pendingId: PendingId
  readonly expiresAt: number
  readonly code: PairingCode | null
}

/**
 * `rootChanged`: the ceremony pinned a different memory root than this device held before its keys
 * were discarded (#12280): a notice the desktop shows, never a refusal. Additive on the wire.
 */
export type SyncEnableResponse =
  | { readonly kind: "joined"; readonly rootChanged?: true }
  | { readonly kind: "first_device_created"; readonly rootChanged?: true }
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

/**
 * How an approval ended. memory-core's outcome never names a service code: a service refusal reaches the adapter as an
 * error, so a code from the contract's list rides on the same `refused` shape the other verbs answer with (#13659).
 */
export type SyncApproveOutcome = ApproveOutcome | Extract<SyncRpcProblem, { readonly kind: "refused" }>

export interface ApprovalProgress {
  readonly pendingId: PendingId
  readonly expiresAt: number
  readonly code: PairingCode | null
  readonly outcome: SyncApproveOutcome | null
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
