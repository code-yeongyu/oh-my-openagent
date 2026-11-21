import {
  ApiRefusal,
  type LiveDevice,
  listLiveDevices,
  renameDevice,
  revokeDevice,
} from "@oh-my-opencode/omo-opencode/service-auth"
import type { AccountAccess } from "../access"
import { ok, type OmoResult, refused } from "../result"

export type { LiveDevice }

export type DevicesApi = {
  readonly list: () => Promise<OmoResult<readonly LiveDevice[]>>
  /** Renames a device of this account and answers it as the account lists it afterwards. */
  readonly rename: (target: { readonly id: string; readonly name: string }) => Promise<OmoResult<LiveDevice>>
  /**
   * Signs ANOTHER device of this account out. `confirmName` must equal the device's current name in a fresh list;
   * this device, an unknown id and a wrong name are refused before any request, and the answer is read back.
   */
  readonly revoke: (target: {
    readonly id: string
    readonly confirmName: string
  }) => Promise<OmoResult<{ readonly revoked: LiveDevice }>>
}

export function createDevicesApi(access: AccountAccess): DevicesApi {
  return {
    list: () => access.signedIn(({ session }) => listLiveDevices(session)),
    rename: ({ id, name }) =>
      access.signedIn(async ({ session }) => {
        await renameDevice(session, id, name)
        const renamed = (await listLiveDevices(session)).find((device) => device.id === id)
        // A device revoked between the rename and the read-back is gone from the account, as a 404 would have said.
        if (renamed === undefined) throw new ApiRefusal("not_found", 404)
        return renamed
      }),
    revoke: async ({ id, confirmName }) => {
      const outcome = await access.signedIn(({ device, session }) =>
        revokeDevice(session, { id, thisDeviceId: device.id, confirmName }),
      )
      if (outcome.kind === "error") return outcome
      const result = outcome.value
      switch (result.kind) {
        case "revoked":
          return ok({ revoked: result.device })
        case "not_found":
          return refused("not_found", "the account has no such device", "list the devices, then use one of their ids")
        case "this_device":
          return refused("this_device", "that is this device", "sign this device out by hand with omo logout")
        case "confirmation_mismatch":
          return refused(
            "confirmation_mismatch",
            "the name does not match the device's current name",
            "list the devices, then pass the device's current name",
          )
        case "still_live":
          return refused(
            "still_live",
            "the account still lists the device after the revoke",
            "list the devices, then retry",
          )
      }
    },
  }
}
