import type { AccountAccess } from "../access"
import { createAccountApi, type SignInProcess } from "../account"
import { launcherSignInProcess } from "../account/sign-in-process"
import { type ConfigFileSystemPort, createConfigApi } from "../config"
import type { CallOptions } from "../contract"
import { createDeviceServiceApi, type DeviceServiceApi, type DeviceServiceStatusPort } from "../device-service"
import { createDevicesApi } from "../devices"
import { accountSignIn } from "./account-sign-in"
import type { NamespaceServing } from "./members"

type Env = Readonly<Record<string, string | undefined>>

const waitSignal = (options: CallOptions): AbortSignal | undefined => {
  const signals = [
    ...(options.signal === undefined ? [] : [options.signal]),
    ...(options.deadline_ms === undefined ? [] : [AbortSignal.timeout(options.deadline_ms)]),
  ]
  return signals.length === 0 ? undefined : AbortSignal.any(signals)
}

// The shipped call takes its signal in the first argument; the root's call takes its input there and its wait options
// (signal, deadline_ms) in the second. A call with a second argument is the root's.
function serviceStatus(api: DeviceServiceApi): DeviceServiceApi["status"] {
  return (first?: { readonly signal?: AbortSignal }, second?: CallOptions) => {
    if (second === undefined) return api.status(first)
    const signal = waitSignal(second)
    return api.status(signal === undefined ? {} : { signal })
  }
}

// The four namespaces the omo SDK shipped (OMO_SDK_ROOT), served by the root as they are: the shipped surface is the
// root itself, extended, so these members keep their signatures, results and close().
export function shippedNamespaces(options: {
  readonly access: AccountAccess
  readonly env: Env
  readonly cwd: string
  readonly home?: string
  readonly signInProcess?: SignInProcess
  readonly deviceServiceStatus?: DeviceServiceStatusPort
  readonly fileSystem?: ConfigFileSystemPort
}): NamespaceServing {
  const account = createAccountApi(options.access, {
    process: options.signInProcess ?? launcherSignInProcess(options.env["OMO_BIN"]),
    env: options.env,
  })
  const devices = createDevicesApi(options.access)
  const deviceService = createDeviceServiceApi({
    env: options.env,
    ...(options.home === undefined ? {} : { home: options.home }),
    ...(options.deviceServiceStatus === undefined ? {} : { status: options.deviceServiceStatus }),
  })
  const config = createConfigApi({
    cwd: options.cwd,
    env: options.env,
    ...(options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem }),
  })
  return {
    members: {
      "account.whoami": account.whoami,
      "account.signIn": accountSignIn(account, options.access.origin),
      "devices.list": devices.list,
      "devices.rename": devices.rename,
      "deviceService.status": serviceStatus(deviceService),
      "config.status": config.status,
    },
    close: options.access.close,
  }
}
