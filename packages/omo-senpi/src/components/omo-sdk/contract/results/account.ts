import type {
  AccountShowResult,
  BootstrapResult,
  ControlState,
  DeviceRow,
  ServiceInfo,
  ServiceStatus,
} from "../../../remote/types"
import type { WhoAmI } from "../../account"
import type { DeviceServiceStatus } from "../../device-service"
import type { LiveDevice } from "../../devices"

// What the account, devices, device service and sync calls answer as their `value`: the shipped omo SDK's and the remote
// module's own types where one exists, otherwise the record the matching `omo` verb prints today with `--json`.
export type {
  AccountShowResult,
  BootstrapResult,
  ControlState,
  DeviceRow,
  LiveDevice,
  ServiceInfo,
  ServiceStatus,
  WhoAmI,
}
export type { DeviceServiceStatus }
export type { ControlSessionWakeState as WakeState } from "../../../../../../device-service-core/src/wire"

export type SignInCheck = { readonly ready: true }

/** `omo logout`: the stored credential and device keys are gone; `revoked` is whether the service confirmed the revoke. */
export type SignedOut = { readonly signedOut: true; readonly revoked: boolean }

export type Forgotten = { readonly forgotten: true }

/** `omo account store status|enable|disable` (N/account-store.ts): where the sign-in lives on this machine. */
export type AccountStore = { readonly store: "omo" | "login"; readonly state?: string; readonly path?: string }

export type Revoked = { readonly revoked: true; readonly device: { readonly id: string; readonly name: string } }

export type Enabled = { readonly enabled: boolean }

type Section<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly reason: string }

/** `omo sync status --json` (N/sync-status-cli.ts SyncStatusReport): ids, flags, times and counts, never key material. */
export type SyncStatusReport = {
  readonly account: string
  readonly deviceId: string
  readonly device: Section<{ readonly joined: boolean; readonly switch: "on" | "off" }>
  readonly devices: Section<{
    readonly list: readonly {
      readonly id: string
      readonly name: string
      readonly syncing?: boolean
      readonly lastSeenAt?: string
      readonly current: boolean
    }[]
  }>
  readonly pending: Section<{
    readonly list: readonly { readonly id: string; readonly expiresAt: string; readonly answered: boolean }[]
  }>
  readonly engine:
    | { readonly kind: "no_engine" }
    | { readonly kind: "running" }
    | { readonly kind: "unreadable"; readonly reason: string }
}

export type SyncDisabled = { readonly enabled: false }

export type SyncApproved = { readonly approved: true; readonly device: string }

export type PinRetired = { readonly retired: true }
