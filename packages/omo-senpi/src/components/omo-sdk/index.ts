import { type AccessPorts, createAccountAccess } from "./access"
import { type AccountApi, createAccountApi } from "./account"
import { type ConfigApi, createConfigApi } from "./config"
import { createDeviceServiceApi, type DeviceServiceApi, type DeviceServiceStatusPort } from "./device-service"
import { createDevicesApi, type DevicesApi } from "./devices"

export type { CredentialStorePort, SessionPort } from "./access"
export type { WhoAmI } from "./account"
export type { ConfigStatus } from "./config"
export type { DeviceServiceStatus, DeviceServiceStatusPort } from "./device-service"
export type { LiveDevice } from "./devices"
export type { OmoError, OmoErrorCode, OmoResult } from "./result"

export type OmoSdkPorts = AccessPorts & { readonly deviceServiceStatus?: DeviceServiceStatusPort }

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
  const access = createAccountAccess({ ...(options.api === undefined ? {} : { api: options.api }), env, cwd, ports })
  return {
    account: createAccountApi(access),
    devices: createDevicesApi(access),
    deviceService: createDeviceServiceApi({
      env,
      ...(options.home === undefined ? {} : { home: options.home }),
      ...(ports.deviceServiceStatus === undefined ? {} : { status: ports.deviceServiceStatus }),
    }),
    config: createConfigApi({ cwd, env }),
    close: access.close,
  }
}
