import { assembleOmoSdk, refuseCallerCores } from "./assembly"
import type { OmoSdk, OmoSdkOptions } from "./options"

export type { CredentialStorePort, SessionPort } from "./access"
export type { SignedIn, SignInOptions, SignInProcess, UserCode, WhoAmI } from "./account"
export type { ConfigStatus } from "./config"
export type { OmoSdkRoot } from "./contract"
export type { DeviceServiceStatus, DeviceServiceStatusPort } from "./device-service"
export type { LiveDevice } from "./devices"
export type { OmoSdk, OmoSdkOptions, OmoSdkPorts, ShippedOmoSdk } from "./options"
export type { OmoError, OmoErrorCode, OmoResult } from "./result"
export type { CoreContext, CoreLoader, CoreLoaders, LauncherNamespace, NamespaceCore } from "./root/members"

/** The omo SDK: one root over every core (first-party design 4.1). Building it opens nothing. */
export function createOmoSdk(options: OmoSdkOptions = {}): OmoSdk {
  refuseCallerCores(options)
  return assembleOmoSdk(options, {})
}
