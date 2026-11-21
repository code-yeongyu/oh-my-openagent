import { type LiveDevice, listLiveDevices } from "@oh-my-opencode/omo-opencode/service-auth"
import type { AccountAccess } from "../access"
import type { OmoResult } from "../result"

export type { LiveDevice }

export type DevicesApi = { readonly list: () => Promise<OmoResult<readonly LiveDevice[]>> }

export function createDevicesApi(access: AccountAccess): DevicesApi {
  return { list: () => access.signedIn(({ session }) => listLiveDevices(session)) }
}
