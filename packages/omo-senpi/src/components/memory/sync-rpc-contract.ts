import type { ApproveOutcome, PhraseVoidNotice } from "@oh-my-opencode/memory-core/sync-engine"

import type { MemoryRpcSync } from "./memory-rpc-sync"

export type SyncEnableMethod = "passkey" | "phrase"
/** `{}` joins or resumes; creating a genesis needs an explicit `method` (D1). */
export type SyncEnableRequest = { readonly method?: SyncEnableMethod }
export type SyncFeaturesRequest = Readonly<Record<string, never>>
/** The features this engine speaks; an engine older than recovery-phrase genesis answers it as an unknown verb. */
export type SyncFeature = "enable-method" | "phrase-genesis" | "acknowledge"
export type SyncFeaturesResponse = { readonly features: readonly SyncFeature[] }
export type SyncAcknowledgeRequest = {
  readonly notice: "phrase_void"
  readonly purpose: PhraseVoidNotice["purpose"]
  readonly credentialId?: string
}
export type SyncAcknowledgeResponse = { readonly ok: true } | SyncRpcProblem
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
  | { readonly kind: "joined"; readonly rootChanged?: true; readonly phraseVoid?: PhraseVoidNotice }
  | { readonly kind: "first_device_created"; readonly rootChanged?: true }
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
