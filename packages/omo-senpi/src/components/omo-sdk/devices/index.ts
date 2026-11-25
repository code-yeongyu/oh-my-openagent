import { ApiRefusal, type LiveDevice, renameDevice } from "@oh-my-opencode/omo-opencode/service-auth"
import { type DeviceRow, type RemoteClientDeps, type RemoteFailure, remoteClientForSession } from "../../remote"
import { createOmoNativeProductConfig } from "../../telemetry/product-identity"
import type { AccountAccess } from "../access"
import { ok, type OmoResult, refused } from "../result"

export type { LiveDevice }

/**
 * A device as this machine's device service lists it. The device service's roster has no `createdAt`, `machineBound` or
 * `syncing`; those are the account view's (`account.devices`).
 */
export type ListedDevice = Omit<LiveDevice, "createdAt" | "machineBound" | "syncing">

export type DevicesApi = {
  /** The account's devices as this machine's device service lists them, this device `current`. */
  readonly list: () => Promise<OmoResult<readonly ListedDevice[]>>
  /** Renames a device of this account and answers it as the account lists it afterwards. */
  readonly rename: (target: { readonly id: string; readonly name: string }) => Promise<OmoResult<LiveDevice>>
}

export type DeviceListing = {
  readonly stateDir: () => string
  readonly timers?: RemoteClientDeps["timers"]
}

// devices.list is the remote module's devices.list (omo#13413): one listing path for every caller. The SDK runs in an eval
// cell that names no session of its own; the listing never reads the sender's id, only that it is a session.
const SENDER = "omo-sdk"

const listedDevice = (row: DeviceRow): ListedDevice => ({
  id: row.id,
  name: row.name,
  ...(row.kind === undefined ? {} : { kind: row.kind }),
  platform: row.platform,
  ...(row.last_seen_ms === null ? {} : { lastSeenAt: new Date(row.last_seen_ms).toISOString() }),
  current: row.self === true,
})

const UNAVAILABLE: ReadonlySet<RemoteFailure["code"]> = new Set([
  "host_unavailable",
  "host_not_answering",
  "no_transport",
  "timeout",
  "cancelled",
])
const SIGNED_OUT: ReadonlySet<unknown> = new Set(["signed_out", "sign_in_required"])
const SERVICE_CHECK = "read deviceService.status for why, then retry"

// The module's failure in this SDK's codes. Its message is not passed on: every message here is the SDK's own text.
function listingFailure(failure: RemoteFailure): OmoResult<never> {
  const localCode = failure.details?.["local_api_code"]
  const details = { code: failure.code, ...(typeof localCode === "string" ? { local_api_code: localCode } : {}) }
  if (SIGNED_OUT.has(localCode))
    return refused("signed_out", "this device is not signed in", "sign this device in to OmO, then retry", details)
  if (UNAVAILABLE.has(failure.code))
    return refused(
      "device_service_unavailable",
      "this machine's device service could not list the account's devices",
      SERVICE_CHECK,
      details,
    )
  if (failure.code === "scope_denied" || failure.code === "relay_requires_paid_plan")
    return refused(
      "service_refused",
      "the device service refused to list the account's devices",
      SERVICE_CHECK,
      details,
    )
  return refused("internal_error", "the device listing failed unexpectedly", "retry; report it if it repeats", details)
}

export function createDevicesApi(access: AccountAccess, listing: DeviceListing): DevicesApi {
  return {
    list: async () => {
      // The account precondition the listing always had: a closed SDK, a desktop launch, a device that is not signed in
      // or a credential store that cannot be read refuses before any device-service connection opens.
      const account = await access.signedIn(async () => undefined)
      if (account.kind === "error") return account
      const client = remoteClientForSession(SENDER, {
        version: createOmoNativeProductConfig().packageVersion,
        stateDir: listing.stateDir(),
        ...(listing.timers === undefined ? {} : { timers: listing.timers }),
      })
      try {
        const listed = await client.devices.list({ signal: access.signal })
        if (listed.kind === "error") return listingFailure(listed)
        // With no device service the module answers this machine as a local-only row, which is no account device.
        if (listed.value.some((row) => row.kind === "local"))
          return refused("device_service_unavailable", "no device service runs on this machine", SERVICE_CHECK, {
            code: "not_installed",
          })
        return ok(listed.value.map(listedDevice))
      } finally {
        client.close()
      }
    },
    rename: ({ id, name }) =>
      access.signedIn(async ({ session }) => {
        const renamed = await renameDevice(session, id, name)
        // A device revoked between the rename and the read-back is gone from the account, as a 404 would have said.
        if (renamed === undefined) throw new ApiRefusal("not_found", 404)
        return renamed
      }),
  }
}
