import type { ApproveOutcome } from "@oh-my-opencode/memory-core/sync-engine"

import type { MemoryRpcSync } from "./memory-rpc-sync"

export type SyncEnableRequest = Readonly<Record<string, never>>
export type SyncPendingRequest = Readonly<Record<string, never>>
export type SyncStatusRequest = Readonly<Record<string, never>>
export type SyncDevicesRequest = Readonly<Record<string, never>>
export type PendingId = string
export type PairingCode = string

export type SyncRpcProblem =
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly reason: string }

export interface JoinProgress {
  readonly pendingId: PendingId
  readonly expiresAt: number
  readonly code: PairingCode | null
}

export type SyncEnableResponse =
  | { readonly kind: "joined" }
  | { readonly kind: "first_device_created" }
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

export type SyncPendingResponse =
  | { readonly pending: readonly PendingDeviceApproval[] }
  | SyncRpcProblem

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
