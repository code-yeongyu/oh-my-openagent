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
export type SignedOut = { readonly signedOut: true; readonly revoked: boolean; readonly audit_unavailable?: true }

/** `audit_unavailable`: a custody record could not be written (security design 8.2); the call ran as it always has. */
export type Forgotten = { readonly forgotten: true; readonly audit_unavailable?: true }

/**
 * `omo account store status|enable|disable`: one shape per verb, what each prints today (design lane ruling,
 * 2026-11-26). Typed fields only; the path is the store's own location.
 */
export type { StoreDisabled, StoreEnabled, StoreStatus } from "@oh-my-opencode/account-core/calls/store"

/** `omo account show`: the record it prints (design lane ruling of 2026-11-26 on typed results); never a token or a key. */
export type { AccountShown } from "@oh-my-opencode/account-core/calls/show"

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
