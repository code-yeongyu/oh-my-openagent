import { Type } from "typebox"

import type { AccountShowResult } from "../../../remote/types"

// The account, devices, device service and sync calls of first-party design 6.3 to 6.6 that carry no credential. The
// account service origin is a root option the security design holds (contract/gated.ts), never an input here.
const Id = Type.String({ minLength: 1 })
const None = Type.Object({})

export const AccountWhoami = None
export const AccountShow = Type.Object({ account: Type.Optional(Id) })
export const AccountSignInCheck = None
export const AccountSignOut = None
export const AccountForget = Type.Object({
  device: Type.Optional(
    Type.String({ minLength: 1, description: "This device's id; another device is devices.revoke." }),
  ),
})
export const AccountStoreStatus = None
export const AccountStoreEnable = None
export const AccountStoreDisable = Type.Object({ discard: Type.Optional(Type.Boolean()) })

export const DevicesList = None
/** The name's bound is the one the sign-in applies (#14523, slice A1c); today the service decides. */
export const DevicesRename = Type.Object({ id: Id, name: Id })
export const DevicesResolve = Type.Object({ device: Id })
export const DevicesRevoke = Type.Object({
  device: Type.String({ minLength: 1, description: "A device id, name or unique id prefix; never this device." }),
  confirm_name: Type.String({ minLength: 1, description: "The device's name, as the confirmation." }),
})

export const DeviceServiceStatus = None
export const DeviceServiceInfo = None
export const DeviceServiceEnable = None
export const DeviceServiceDisable = None
export const DeviceServiceControl = None
export const DeviceServiceSetControl = Type.Object({ on: Type.Boolean() })
export const DeviceServiceWake = None
export const DeviceServiceSetWake = Type.Object({
  on: Type.Union([Type.Boolean(), Type.Null()], { description: "null removes the stored value; the default applies." }),
})
export const DeviceServiceBootstrap = Type.Object({
  account: Type.Optional(Type.Unsafe<AccountShowResult>({ type: "object" })),
  install: Type.Optional(Type.Boolean()),
  adopt: Type.Optional(Type.Boolean()),
})

export const SyncStatus = None
export const SyncDisable = None
export const SyncApprove = Type.Object({
  id: Type.Optional(Id),
  confirmCode: Type.String({ minLength: 1, description: "The code the person compared on both screens." }),
})
export const SyncRetirePin = Type.Object({ account: Id })
