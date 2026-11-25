import type { AccountAccess } from "../access"
import { createAccountApi, type SignInProcess } from "../account"
import { launcherSignInProcess } from "../account/sign-in-process"
import { createConfigApi } from "../config"
import { createDeviceServiceApi, type DeviceServiceStatusPort } from "../device-service"
import { createDevicesApi } from "../devices"
import { accountSignIn } from "./account-sign-in"
import type { NamespaceServing } from "./members"

type Env = Readonly<Record<string, string | undefined>>

// The four namespaces the omo SDK shipped (OMO_SDK_ROOT), served by the root as they are: the shipped surface is the
// root itself, extended, so these members keep their signatures, results and close().
export function shippedNamespaces(options: {
  readonly access: AccountAccess
  readonly env: Env
  readonly cwd: string
  readonly home?: string
  readonly signInProcess?: SignInProcess
  readonly deviceServiceStatus?: DeviceServiceStatusPort
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
  const config = createConfigApi({ cwd: options.cwd, env: options.env })
  return {
    members: {
      "account.whoami": account.whoami,
      "account.signIn": accountSignIn(account, options.access.origin),
      "devices.list": devices.list,
      "devices.rename": devices.rename,
      "deviceService.status": deviceService.status,
      "config.status": config.status,
    },
    close: options.access.close,
  }
}
