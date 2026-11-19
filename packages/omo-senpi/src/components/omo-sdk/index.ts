import { type AccessPorts, createAccountAccess } from "./access"
import { type AccountApi, createAccountApi, type SignInProcess } from "./account"
import { launcherSignInProcess } from "./account/sign-in-process"
import { type ConfigApi, createConfigApi } from "./config"
import { createDeviceServiceApi, type DeviceServiceApi, type DeviceServiceStatusPort } from "./device-service"
import { createDevicesApi, type DevicesApi } from "./devices"
import { type EnrollOutcome, type EnrollPorts, type EnrollRequest, enrollDevice } from "./enroll"
import { defaultEnrollPorts } from "./enroll/default-ports"

export type { CredentialStorePort, SessionPort } from "./access"
export type { SignedIn, SignInOptions, SignInProcess, UserCode, WhoAmI } from "./account"
export type { ConfigStatus } from "./config"
export type { DeviceServiceStatus, DeviceServiceStatusPort } from "./device-service"
export type { LiveDevice } from "./devices"
export type { EnrollCode, EnrollOutcome, EnrollRequest, EnrollStep, SshTarget, StepReceipt } from "./enroll"
export type { OmoError, OmoErrorCode, OmoResult } from "./result"

export type OmoSdkPorts = AccessPorts & {
  readonly deviceServiceStatus?: DeviceServiceStatusPort
  /** Runs `omo account sign-in`; absent, the omo launcher this engine was started from (`OMO_BIN`). */
  readonly signInProcess?: SignInProcess
  /** Replaces any of enroll's own ports (SSH, clock, account and device-service reads). */
  readonly enroll?: Partial<EnrollPorts>
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
  /** Takes a machine reachable over SSH to signed in and online in this account's device list. */
  readonly enrollDevice: (request: EnrollRequest) => Promise<EnrollOutcome>
  /** Aborts requests in flight; later account and device calls answer `internal_error`. */
  readonly close: () => void
}

export function createOmoSdk(options: OmoSdkOptions = {}): OmoSdk {
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const ports = options.ports ?? {}
  const access = createAccountAccess({ ...(options.api === undefined ? {} : { api: options.api }), env, cwd, ports })
  return {
    account: createAccountApi(access, {
      process: ports.signInProcess ?? launcherSignInProcess(env["OMO_BIN"]),
      env,
    }),
    devices: createDevicesApi(access),
    deviceService: createDeviceServiceApi({
      env,
      ...(options.home === undefined ? {} : { home: options.home }),
      ...(ports.deviceServiceStatus === undefined ? {} : { status: ports.deviceServiceStatus }),
    }),
    config: createConfigApi({ cwd, env }),
    enrollDevice: (request) => {
      const blocked = access.blockedReason()
      if (blocked?.kind === "error")
        return Promise.resolve({
          kind: "refused",
          api: access.origin,
          step: "request",
          code: "caller_signed_out",
          message: blocked.error.message,
          next_action: blocked.error.next_action,
          steps: [],
        })
      const defaults = defaultEnrollPorts({
        access,
        env,
        ...(options.home === undefined ? {} : { home: options.home }),
      })
      return enrollDevice(request, { ...defaults, ...ports.enroll })
    },
    close: access.close,
  }
}
