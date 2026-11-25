import { openSignInBrowser } from "../browser"
import type { DisplayCode } from "../device-flow"
import { deviceName, devicePlatform } from "../device-name"
import type { CredentialStore } from "../keystore"
import { beginLogin } from "../login-prelude"
import { signInByRoute } from "../login-routes"
import { advertisesMachineIdentity, readMachineDigest } from "../machine-digest"
import type { ChooseDevice, ListedDevice, MachineDevice } from "../protocol"
import type { DeviceServiceHandoff, Session } from "../session"
import { type Audited, audited, type CustodyLog } from "./custody-log"
import { type CallOutcome, ok, refusedWith } from "./outcome"
import { type SignInRefusal, signInRefusal } from "./sign-in-refusal"

// account.signIn (first-party design 6.4, security design 5.4): the device-code sign-in and the browser sign-in as one
// call, run in this process. The codes a person approves go to onUserCode and nowhere else. `omo login` and
// `omo account sign-in` render it; neither runs a child for it.

export type SignInMethod = "device_code" | "browser"

/** The OmO sign-in page. `accounts.omo.dev` is the identity provider's own account portal (#9965). */
export const DEFAULT_ACCOUNTS_ORIGIN = "https://signin.omo.dev"

/** What the device-service setup after a fresh sign-in did, or `not_run` when the caller supplied no setup. */
export type DeviceServiceOutcome = "on" | "kept_off" | "not_on" | "background" | "not_run"

export type SignedIn = {
  readonly api: string
  readonly device: { readonly id: string; readonly name: string }
  readonly replacedDeviceId?: string
  readonly deviceService: DeviceServiceOutcome
}

export type SignInDependencies = {
  readonly api: string
  readonly session: Session
  readonly store: Pick<CredentialStore, "read">
  readonly deviceService?: DeviceServiceHandoff
  /** Whether OmO accounts are open; while closed only the device-code method is admitted. */
  readonly accountsOpen: boolean
  /** The device-service setup a fresh sign-in runs (launcher code); absent, it is not run and the answer says so. */
  readonly setUpDeviceService?: (signal?: AbortSignal) => Promise<Exclude<DeviceServiceOutcome, "not_run">>
  readonly machineDigest?: () => Promise<string | undefined>
  readonly now?: () => number
  readonly sleep?: (ms: number) => Promise<void>
  /** The custody log (security design 8.2); the sign-in never waits on it. */
  readonly custody?: CustodyLog
}

export type SignInRequest = {
  readonly method: SignInMethod
  /** false is `--no-browser`: the browser method falls back to the device code without opening a page. */
  readonly openBrowser?: boolean
  readonly accounts?: string
  readonly deviceName?: string
  /** Receives the code a person approves, and the call's signal so a pending callback can stop with it. */
  readonly onUserCode: (code: DisplayCode, signal?: AbortSignal) => void | Promise<void>
  /** Opens the sign-in page; absent, the system browser. Answers whether a page opened. */
  readonly onOpenUrl?: (url: string) => Promise<boolean>
  /** Called once the service answered its health probe, before any code is minted or page opened. */
  readonly onStarted?: () => void
  /** Picks a device to remove at the device limit; absent, none is removed and the list comes back with the refusal. */
  readonly chooseDevice?: ChooseDevice
  /** Whether to replace this machine's earlier device when the service names one; absent, it is not replaced. */
  readonly replaceDevice?: (existing: MachineDevice) => Promise<boolean>
  /**
   * Cancels the sign-in. The commit point is the request that turns the approval into a granted device together with
   * the store write after it; an abort never splits it. Before it, the call answers `cancelled`: nothing is stored and
   * no device was granted. At or after it, this machine is signed in: the call answers signed in, the device-service
   * setup not run or no longer waited on (`not_on`, the answer when the setup does not finish). A pending onUserCode or
   * setup is not waited on once the signal aborts; each receives the signal.
   */
  readonly signal?: AbortSignal
}

export type SignInFailure = SignInRefusal | { readonly code: "accounts_closed" } | { readonly code: "cancelled" }

const ABORTED = Symbol("aborted")

/**
 * Settles with the work, or with ABORTED the moment the signal aborts; the work is not waited on after that, but it is
 * still observed: a cooperative callback that rejects as the cancellation reaches it leaves no unhandled rejection.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof ABORTED> {
  if (signal === undefined) return work
  if (signal.aborted) {
    work.catch(() => undefined)
    return Promise.resolve(ABORTED)
  }
  return new Promise((resolve, reject) => {
    const stop = () => resolve(ABORTED)
    signal.addEventListener("abort", stop, { once: true })
    work.then(
      (value) => {
        signal.removeEventListener("abort", stop)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", stop)
        reject(error)
      },
    )
  })
}

export function accountSignIn(
  deps: SignInDependencies,
  request: SignInRequest,
): Promise<CallOutcome<Audited<SignedIn>, SignInFailure>> {
  // A sign-in the caller cancelled after the commit point is signed in without its setup: partial in the custody log.
  return audited(
    deps.custody,
    "account.signIn",
    () => signIn(deps, request),
    (value) =>
      request.signal?.aborted === true && value.deviceService === "not_on"
        ? { outcome: "partial", code: "setup_cancelled" }
        : { outcome: "ok" },
  )
}

async function signIn(deps: SignInDependencies, request: SignInRequest): Promise<CallOutcome<SignedIn, SignInFailure>> {
  if (!deps.accountsOpen && request.method !== "device_code") return refusedWith({ code: "accounts_closed" })
  const { signal } = request
  const cancelled = (): boolean => signal?.aborted === true
  if (cancelled()) return refusedWith({ code: "cancelled" })
  let limitDevices: readonly ListedDevice[] | undefined
  let callback: Promise<void> = Promise.resolve()
  let replacedDeviceId: string | undefined
  try {
    const health = await beginLogin(deps.session, deps.deviceService, deps.api)
    const digest = advertisesMachineIdentity(health) ? await (deps.machineDigest ?? readMachineDigest)() : undefined
    request.onStarted?.()
    const name = request.deviceName ?? deviceName()
    const platform = devicePlatform()
    const chooseDevice: ChooseDevice =
      request.chooseDevice ??
      (async (devices) => {
        limitDevices = devices
        return null
      })
    const result = await signInByRoute(deps.session, {
      ...(request.method === "browser" && request.openBrowser !== false
        ? {
            loopback: {
              accounts: request.accounts ?? DEFAULT_ACCOUNTS_ORIGIN,
              name,
              platform,
              open: request.onOpenUrl ?? openSignInBrowser,
              chooseDevice,
              ...(digest === undefined ? {} : { machineDigest: digest }),
            },
          }
        : {}),
      device: {
        name,
        platform,
        chooseDevice,
        replaceDevice: request.replaceDevice ?? (async () => false),
        ...(digest === undefined ? {} : { machineDigest: digest }),
        ...(deps.now === undefined ? {} : { now: deps.now }),
        ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
        show: (code) => {
          callback = Promise.resolve(request.onUserCode(code, signal))
        },
      },
    })
    replacedDeviceId = result.replacedDeviceId
    // Past the commit point: a callback still pending is no longer waited on once the caller aborts.
    await untilAborted(callback, signal)
  } catch (error) {
    await untilAborted(
      callback.catch(() => undefined),
      signal,
    )
    if (cancelled() && (await deps.store.read().catch(() => null)) === null) return refusedWith({ code: "cancelled" })
    return refusedWith(signInRefusal(error, limitDevices))
  }
  const stored = await deps.store.read()
  if (stored === null)
    return refusedWith({
      code: "internal_error",
      message: "the approved sign-in was not stored",
      next_action: "sign in again",
      cause: undefined,
    })
  const setUp = deps.setUpDeviceService
  const settled =
    setUp === undefined
      ? ("not_run" as const)
      : cancelled()
        ? ABORTED
        : await untilAborted(
            setUp(signal).catch(() => "not_on" as const),
            signal,
          )
  const deviceService: DeviceServiceOutcome = settled === ABORTED ? "not_on" : settled
  return ok({
    api: deps.api,
    device: { id: stored.device.id, name: stored.device.name },
    ...(replacedDeviceId === undefined ? {} : { replacedDeviceId }),
    deviceService,
  })
}
