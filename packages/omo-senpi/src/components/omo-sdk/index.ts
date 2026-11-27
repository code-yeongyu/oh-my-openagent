import { homedir } from "node:os"
import { deviceServiceStateDir } from "@oh-my-opencode/device-service-core/state-dir"
import { type AccessPorts, createAccountAccess } from "./access"
import { type AccountApi, createAccountApi, type SignInProcess } from "./account"
import { launcherSignInProcess } from "./account/sign-in-process"
import { type ConfigApi, createConfigApi } from "./config"
import { createDeviceServiceApi, type DeviceServiceApi, type DeviceServiceStatusPort } from "./device-service"
import { createDevicesApi, type DeviceListing, type DevicesApi } from "./devices"

export type { CredentialStorePort, SessionPort } from "./access"
export type { SignedIn, SignInOptions, SignInProcess, UserCode, WhoAmI } from "./account"
export type { ConfigStatus } from "./config"
export type { DeviceServiceStatus, DeviceServiceStatusPort } from "./device-service"
export type { ListedDevice, LiveDevice } from "./devices"
export type { OmoError, OmoErrorCode, OmoResult } from "./result"

export type OmoSdkPorts = AccessPorts & {
  readonly deviceServiceStatus?: DeviceServiceStatusPort
  /** The clock of devices.list's device-service client; absent, real timers. */
  readonly remoteTimers?: DeviceListing["timers"]
  /** Runs `omo account sign-in`; absent, the omo launcher this engine was started from (`OMO_BIN`). */
  readonly signInProcess?: SignInProcess
}

export type OmoSdkOptions = {
  /** The account service origin; else `OMO_SERVICE_API_URL` from `env`, else the production API. */
  readonly api?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly cwd?: string
  /** The home the device service's state dir resolves under; absent, the user's own. */
  readonly home?: string
  readonly ports?: OmoSdkPorts
}

export type OmoSdk = {
  readonly account: AccountApi
  readonly devices: DevicesApi
  readonly deviceService: DeviceServiceApi
  readonly config: ConfigApi
  /** Aborts requests in flight; later account and device calls answer `internal_error`. */
  readonly close: () => void
}

export function createOmoSdk(options: OmoSdkOptions = {}): OmoSdk {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const ports = options.ports ?? {}
  // The state dir rule the fleet SDK's transport picker uses (#13597): status and devices.list read the same service.
  const stateDir = () => deviceServiceStateDir(process.platform, env, options.home ?? homedir())
  const access = createAccountAccess({ ...(options.api === undefined ? {} : { api: options.api }), env, cwd, ports })
  return {
    account: createAccountApi(access, {
      process: ports.signInProcess ?? launcherSignInProcess(env["OMO_BIN"]),
      env,
    }),
    devices: createDevicesApi(access, {
      stateDir,
      ...(ports.remoteTimers === undefined ? {} : { timers: ports.remoteTimers }),
    }),
    deviceService: createDeviceServiceApi({
      stateDir,
      ...(ports.deviceServiceStatus === undefined ? {} : { status: ports.deviceServiceStatus }),
    }),
    config: createConfigApi({ cwd, env }),
    close: access.close,
  }
}
