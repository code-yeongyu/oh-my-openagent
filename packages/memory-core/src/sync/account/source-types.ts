import type { DeviceKeyring } from "../keyring-port"
import type { Transport } from "../engine/ports"
import type { AccountHttp } from "./http"
import type { PairingHttp } from "./pairing-http"
import type { SyncOperationAuthority } from "../operation-authority"
import type { GenesisBridge } from "../genesis/bridge.ts"
export type { SyncOperationAuthority } from "../operation-authority"

/** Public selected-account identity. Credentials and private key material have no fields here. */
export interface DesktopSyncDescriptor {
  readonly genesis: "supported" | "unsupported"
  readonly rpId: string | null
  readonly userName: string | null
  readonly serviceOrigin: string
  readonly accountId: string
  readonly serviceDeviceId: string
  readonly syncPrincipalId: string
  readonly publicKeys: { readonly signing: string; readonly sealing: string }
  readonly generation: string
  /** The issuing main incarnation for a desktop account; the CLI reports "cli". */
  readonly incarnation: string
}

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

export interface DesktopSyncOperation {
  readonly keyring: DeviceKeyring
  readonly chain: AccountHttp
  readonly pairing: PairingHttp
  /** Bound to this operation's main-issued handle; absent for the CLI source, never on background ports. */
  readonly genesis?: GenesisBridge
  devices(): Promise<readonly SyncDevice[]>
  close(): Promise<void>
}

export interface DesktopSyncAccount extends Omit<DesktopSyncOperation, "close" | "genesis"> {
  readonly kind: "desktop"
  readonly descriptor: DesktopSyncDescriptor
  readonly signal: AbortSignal
  readonly transport: Transport
  isCurrent(): Promise<boolean>
  boundary<T>(dispatch: () => T): Promise<T>
  forOperation(authority: SyncOperationAuthority): Promise<DesktopSyncOperation>
}
