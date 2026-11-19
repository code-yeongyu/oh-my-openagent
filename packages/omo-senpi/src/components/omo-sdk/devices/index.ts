import {
  ApiRefusal,
  type LiveDevice,
  listLiveDevices,
  renameDevice,
} from "@oh-my-opencode/omo-opencode/service-auth"
import type { AccountAccess } from "../access"
import type { OmoResult } from "../result"

export type { LiveDevice }

export type DevicesApi = {
  readonly list: () => Promise<OmoResult<readonly LiveDevice[]>>
  /** Renames a device of this account and answers it as the account lists it afterwards. */
  readonly rename: (target: { readonly id: string; readonly name: string }) => Promise<OmoResult<LiveDevice>>
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
  }
}
