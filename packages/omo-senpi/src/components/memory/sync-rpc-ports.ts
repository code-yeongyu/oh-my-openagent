import type { DeviceKeyring } from "@oh-my-opencode/memory-core/keyring"
import type { AccountHttp, PairingHttp, CeremonyClock, ApproveOutcome, JoinOutcome, EnableOutcome, DesktopSyncAccount, DesktopSyncDescriptor, DesktopSyncOperation } from "@oh-my-opencode/memory-core/sync-engine"
import type { MemoryRpcSync } from "./memory-rpc-sync"

/** The permanent upstream interface, including undefined on internal calls. */
export interface SyncRpcContext {
  readonly ownerId: string
  readonly disconnectSignal: AbortSignal
  admit<T>(dispatch: () => T): T
}

export interface SyncRpcRegistration {
  handle(name: string, handler: (data: unknown, context?: SyncRpcContext) => unknown | Promise<unknown>): void
}

export interface SyncRpcAuthority {
  readonly signal: AbortSignal
  admit<T>(dispatch: () => T): T
  boundary<T>(dispatch: () => T): Promise<T>
}

export type SyncRpcIdentity = DesktopSyncDescriptor

/** Selected source only: this port never reconstructs or falls back to CLI credentials. */
export type SyncRpcAccount = Pick<DesktopSyncAccount, "descriptor" | "signal" | "isCurrent" | "boundary" | "forOperation">

export type SyncRpcOperation = DesktopSyncOperation

export interface SyncRpcCeremonyInput {
  readonly account: string
  readonly keyring: DeviceKeyring
  readonly chain: AccountHttp
  readonly pairing: PairingHttp
  readonly pinDir: string
  readonly authority: SyncRpcAuthority
  readonly signal: AbortSignal
}

export interface SyncRpcRuntime {
  enableSync(input: SyncRpcCeremonyInput & {
    readonly serviceDeviceId: string
    readonly serviceOrigin: string
    readonly rpId?: string
    readonly userName?: string
    readonly genesis?: DesktopSyncOperation["genesis"]
  }): Promise<EnableOutcome & { readonly created?: true }>
  joinAccount(input: SyncRpcCeremonyInput & {
    readonly clock: CeremonyClock
    readonly showCode: (code: string) => void
    readonly onPending: (row: { readonly id: string; readonly expires_at: number }) => void
  }): Promise<JoinOutcome>
  approveDevice(input: SyncRpcCeremonyInput & {
    readonly clock: CeremonyClock
    readonly pendingId: string
    readonly confirmCode: (code: string) => Promise<boolean>
    readonly onAnswered: (row: { readonly id: string; readonly expires_at: number }) => void
  }): Promise<ApproveOutcome>
}

export interface SyncRpcClaim {
  expiresAt(value: number): Promise<void>
  release(): Promise<void>
}

export interface SyncRpcClaims {
  acquire(identity: SyncRpcIdentity, operation: "enable" | "approve", pendingId: string | undefined, authority: SyncRpcAuthority): Promise<SyncRpcClaim | null>
}

export interface SyncRpcOptions {
  readonly source: () => Promise<SyncRpcAccount | null>
  readonly runtime: SyncRpcRuntime
  readonly claims: SyncRpcClaims
  readonly pinDir: string
  readonly signal: AbortSignal
  readonly syncStatus: () => Promise<MemoryRpcSync | undefined>
  readonly clock?: CeremonyClock
}
