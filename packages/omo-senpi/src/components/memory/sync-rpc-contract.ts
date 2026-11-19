import type { ApproveOutcome, PhraseVoidNotice } from "@oh-my-opencode/memory-core/sync-engine"

import type { MemoryRpcSync } from "./memory-rpc-sync"

export type SyncEnableMethod = "passkey" | "phrase"
/** `{}` joins or resumes; creating a genesis needs an explicit `method` (D1). */
export type SyncEnableRequest = { readonly method?: SyncEnableMethod }
export type SyncFeaturesRequest = Readonly<Record<string, never>>
/**
 * The features this engine speaks; an engine older than recovery-phrase genesis answers it as an unknown verb.
 * `disable` (#14093): the engine answers `omo.memory.sync.disable`, so a client offers Turn off only when it is listed.
 */
export type SyncFeature = "enable-method" | "phrase-genesis" | "acknowledge" | "disable"
export type SyncFeaturesResponse = { readonly features: readonly SyncFeature[] }
export type SyncAcknowledgeRequest = {
  readonly notice: "phrase_void"
  readonly purpose: PhraseVoidNotice["purpose"]
  readonly credentialId?: string
}
export type SyncAcknowledgeResponse = { readonly ok: true } | SyncRpcProblem
export type SyncDisableRequest = Readonly<Record<string, never>>
/**
 * `off`: memory sync is off on this device, on the service and locally (#14093); a device that was already off
 * answers it too. Memory on this device is not touched and the account's other devices keep syncing.
 */
export type SyncDisableResponse = { readonly kind: "off" } | SyncRpcProblem
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
  | ({ readonly kind: "joined"; readonly phraseVoid?: PhraseVoidNotice } & SyncRootNotice)
  | ({ readonly kind: "first_device_created" } & SyncRootNotice)
  /** Legacy: kept decodable for older engines; this engine never emits it. */
  | { readonly kind: "needs_first_device" }
  | {
      readonly kind: "method_required"
      readonly methods: readonly SyncEnableMethod[]
      readonly phraseVoid?: PhraseVoidNotice
    }
  | { readonly kind: "acknowledge_required"; readonly phraseVoid: PhraseVoidNotice }
  | { readonly kind: "passkey_unavailable" }
  | {
      readonly kind: "phrase_unavailable"
      readonly reason: "no-surface" | "disabled" | "service-floor-off"
      readonly deviceSyncLeftOn?: true
    }
  | { readonly kind: "cancelled" }
  /** A recovery ceremony is open on this device (or another process holds it); never carries words. */
  | { readonly kind: "in_progress"; readonly method?: SyncEnableMethod }
  | { readonly kind: "join_required"; readonly pairing: JoinProgress; readonly phraseVoid?: PhraseVoidNotice }
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
      /** Read-only: a shown recovery phrase that was not saved; a read never clears it. */
      readonly phraseVoid?: PhraseVoidNotice
      readonly phraseUnresolved?: true
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
