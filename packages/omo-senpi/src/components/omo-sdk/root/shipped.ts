import type { AccountAccess } from "../access"
import { createAccountApi, type SignInProcess } from "../account"
import { launcherSignInProcess } from "../account/sign-in-process"
import { createConfigApi } from "../config"
import { homedir } from "node:os"
import { deviceServiceStateDir } from "@oh-my-opencode/device-service-core/state-dir"
import type { CallOptions } from "../contract"
import { OMO_CODE_REGISTRY } from "../contract/codes"
import { createDeviceServiceApi, type DeviceServiceApi, type DeviceServiceStatusPort } from "../device-service"
import { createDevicesApi, type DeviceListing } from "../devices"
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

// account.devices's core waits on the account service and takes neither option, so the root honours them on the answer
// (design lane ruling (A)): the caller's signal or deadline answers cancelled or timeout at once, while the read, which
// changes nothing, runs on until close() aborts it. Its late result and late rejection are both dropped here.
function answeredInTime<T>(read: () => Promise<T>): (input?: unknown, options?: CallOptions) => Promise<T> {
  return (_input, options = {}) => {
    const signal = waitSignal(options)
    if (signal === undefined) return read()
    const stopped = (): T =>
      ({
        kind: "error",
        error:
          signal.reason instanceof DOMException && signal.reason.name === "TimeoutError"
            ? {
                code: "timeout",
                message: "The call passed its deadline_ms.",
                next_action: OMO_CODE_REGISTRY.timeout.next_action,
              }
            : {
                code: "cancelled",
                message: "The call was cancelled by its signal.",
                next_action: OMO_CODE_REGISTRY.cancelled.next_action,
              },
      }) as T
    if (signal.aborted) return Promise.resolve(stopped())
    const reading = read()
    reading.catch(() => undefined)
    return Promise.race([
      reading,
      new Promise<T>((resolve) => signal.addEventListener("abort", () => resolve(stopped()), { once: true })),
    ])
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
  readonly remoteTimers?: DeviceListing["timers"]
}): NamespaceServing {
  const account = createAccountApi(options.access, {
    process: options.signInProcess ?? launcherSignInProcess(options.env["OMO_BIN"]),
    env: options.env,
  })
  // The state dir rule the fleet SDK's transport picker uses (#13597): status and devices.list read the same service.
  const stateDir = () => deviceServiceStateDir(process.platform, options.env, options.home ?? homedir())
  const devices = createDevicesApi(options.access, {
    stateDir,
    ...(options.remoteTimers === undefined ? {} : { timers: options.remoteTimers }),
  })
  const deviceService = createDeviceServiceApi({
    stateDir,
    ...(options.deviceServiceStatus === undefined ? {} : { status: options.deviceServiceStatus }),
  })
  const config = createConfigApi({ cwd: options.cwd, env: options.env })
  return {
    members: {
      "account.whoami": account.whoami,
      "account.devices": answeredInTime(account.devices),
      "account.signIn": accountSignIn(account, options.access.origin),
      "devices.list": devices.list,
      "devices.rename": devices.rename,
      "deviceService.status": serviceStatus(deviceService),
      "config.status": config.status,
    },
    legacy: ["account.signIn"],
    close: options.access.close,
  }
}
