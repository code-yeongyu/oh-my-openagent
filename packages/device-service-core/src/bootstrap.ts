import { existsSync } from "node:fs"
import { type AccountShowResult, type AccountState, accountStateNotice, classifyAccountShow } from "./account-state.ts"
import { type DeviceCredential, type DeviceService, deviceServiceEndpointPath, LocalApiError, type Status } from "./device-service.ts"
import type { InstallOutcome } from "./install.ts"
import { compareVersions } from "./release/version.ts"

const BOOTSTRAP_STOPPED_EXIT = 3

export type BootstrapStopState = "signed_out" | "keychain_locked" | "service_degraded" | "account_unavailable" | "update_required"

export type BootstrapOutcome =
  | { readonly kind: "connected"; readonly status: Status; readonly service: DeviceService }
  | { readonly kind: "stopped"; readonly state: BootstrapStopState; readonly notice: string; readonly exitCode: typeof BOOTSTRAP_STOPPED_EXIT }

export type BootstrapDependencies = {
  /** `omo account show`; nothing else runs unless it reports signed in. */
  readonly accountShow: () => Promise<AccountShowResult>
  readonly stateDir: string
  /** The device service version this omo build pins; an older running service is replaced. */
  readonly pinVersion: string
  readonly install: () => Promise<InstallOutcome>
  readonly connect: () => Promise<DeviceService>
  /** The stored sign-in's device and keys, read only after `omo account show` reported signed in. */
  readonly credential: () => Promise<DeviceCredential | null>
  readonly refresher: { readonly binaryPath: string; readonly version: string }
  readonly agentDir: string
}

const ACCOUNT_STOP: Readonly<Record<Exclude<AccountState["kind"], "signed_in">, BootstrapStopState>> = {
  signed_out: "signed_out",
  keychain_locked: "keychain_locked",
  store_unavailable: "service_degraded",
  account_unavailable: "account_unavailable",
}

const stopped = (state: BootstrapStopState, notice: string): BootstrapOutcome => ({ kind: "stopped", state, notice, exitCode: BOOTSTRAP_STOPPED_EXIT })

/** A service that is not running: its socket is gone (POSIX) or its loopback port refuses or never answers (Windows). */
const isServiceStopped = (error: unknown): boolean =>
  (error instanceof Error && "code" in error && ["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(String(error.code))) ||
  (error instanceof LocalApiError && error.code === "handshake_timeout")

const failureNotice = (error: unknown): string =>
  error instanceof LocalApiError
    ? (error.action ?? `The OmO device service did not answer as expected (${error.reason}). Try again; if it keeps failing, report it with /bug.`)
    : "The OmO device service could not be reached. Try again; if it keeps failing, report it with /bug."

// A running service at the pin or newer, "absent" when none runs (or an older one does, which install replaces), or the
// outcome that stops the bootstrap, such as a service that cannot prove the per-boot token.
const connectCurrent = async (deps: BootstrapDependencies): Promise<DeviceService | "absent" | BootstrapOutcome> => {
  if (!existsSync(deviceServiceEndpointPath(deps.stateDir))) return "absent"
  let service: DeviceService
  try {
    service = await deps.connect()
  } catch (error) {
    return isServiceStopped(error) ? "absent" : stopped("service_degraded", failureNotice(error))
  }
  if (compareVersions(service.serviceVersion, deps.pinVersion) >= 0) return service
  service.close()
  return "absent"
}

const connectInstalled = async (deps: BootstrapDependencies): Promise<DeviceService | BootstrapOutcome> => {
  const current = await connectCurrent(deps)
  if (current !== "absent") return current
  const installed = await deps.install()
  if (!installed.ok) return stopped(installed.state, installed.action)
  try {
    return await deps.connect()
  } catch (error) {
    return stopped("service_degraded", failureNotice(error))
  }
}

/**
 * The device service bootstrap of every omo start: `omo account show` first; only when signed in, ensure the pinned
 * service is installed, connect (mutual proof), register the refresher, adopt the device, register this agent dir, and
 * read the status.
 */
export const bootstrapDeviceService = async (deps: BootstrapDependencies): Promise<BootstrapOutcome> => {
  const account = classifyAccountShow(await deps.accountShow())
  if (account.kind !== "signed_in") return stopped(ACCOUNT_STOP[account.kind], accountStateNotice(account) ?? "")
  const credential = await deps.credential()
  if (credential === null)
    return stopped("account_unavailable", accountStateNotice({ kind: "account_unavailable", reason: "no device keys are stored" }) ?? "")
  const service = await connectInstalled(deps)
  if ("kind" in service) return service
  try {
    await service.registerRefresher(deps.refresher.binaryPath, deps.refresher.version)
    await service.adopt(credential)
    await service.registerEndpoints(deps.agentDir)
    return { kind: "connected", status: await service.status(), service }
  } catch (error) {
    service.close()
    return stopped("service_degraded", failureNotice(error))
  }
}

/** `omo logout`: a running service forgets this device. Without a running service there is nothing to tell. */
export const forgetDeviceService = async (options: {
  readonly stateDir: string
  readonly connect: () => Promise<DeviceService>
}): Promise<"forgotten" | "not_running"> => {
  if (!existsSync(deviceServiceEndpointPath(options.stateDir))) return "not_running"
  let service: DeviceService
  try {
    service = await options.connect()
  } catch (error) {
    if (isServiceStopped(error)) return "not_running"
    throw error
  }
  try {
    await service.forget()
  } finally {
    service.close()
  }
  return "forgotten"
}
