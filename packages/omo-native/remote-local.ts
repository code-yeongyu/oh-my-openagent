import { existsSync } from "node:fs"

import {
  type AccountShowResult,
  accountStateNotice,
  classifyAccountShow,
} from "../device-service-core/src/account-state.ts"
import {
  connectDeviceService,
  type DeviceRow,
  type DeviceService,
  deviceServiceEndpointPath,
  deviceServiceStateDir,
  LocalApiError,
  type Status,
} from "../device-service-core/src/device-service.ts"
import type { RemoteThreadSurface } from "../omo-senpi/src/components/thread/remote/ports"
import { readAccountInProcess } from "./account-show"
import type { LocalStatus } from "./remote-cold-wake"
import packageJson from "./package.json" with { type: "json" }
import { type Parsed, storedWake } from "./remote-args"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import {
  controlLines,
  deviceLines,
  type ListedDevice,
  localRows,
  sessionLines,
  statusLines,
  wakeLines,
} from "./remote-render"
import { runSession } from "./remote-session-verbs"

// The `omo remote` verbs whose whole call path is the account read plus this device's local API (omo#13440): argument
// parsing, the account notice, the connection, and each verb's body. `remote-cli.ts` keeps usage, `bootstrap` (a
// download) and `attach` (the engine) and delegates the rest here; nothing in this module reaches the network.

/**
 * The account's devices with this one first. relayd's roster usually leaves this device out (#13402); then its row is
 * made from the service's status, with no invented kind. A roster row for this device is kept with its kind and moved
 * first. Either way this device reads online only while its own service is connected: the service's state wins over
 * the roster's presence.
 */
function withThisDevice(roster: readonly DeviceRow[], status: Status): readonly ListedDevice[] {
  const self = status.device
  const online = status.state === "connected"
  const rows = roster.map((row) =>
    row.device === self?.id ? { ...row, online, this_device: true } : { ...row, this_device: false },
  )
  if (self === null) return rows
  const peers = rows.filter((row) => !row.this_device)
  // A roster that already lists this device keeps that row, moved first.
  if (peers.length < rows.length) return [...rows.filter((row) => row.this_device), ...peers]
  const here: ListedDevice = {
    device: self.id,
    label: self.name,
    platform: process.platform,
    last_seen_ms: null,
    online,
    this_device: true,
  }
  return [here, ...peers]
}

export interface RemoteCommandDependencies {
  /** `omo account show`: the first bootstrap step; nothing else runs unless it reports signed in. */
  readonly accountShow: () => Promise<AccountShowResult>
  readonly stateDir: string
  readonly connect: () => Promise<DeviceService>
  readonly now: () => number
  readonly output: (line: string) => void
  /** Text as it arrives, with no line ending added: `send` streams the answer through it. */
  readonly write: (text: string) => void
  readonly error: (line: string) => void
  /** The thread tools' remote surface over a connected service; the device service's own by default. Test seam. */
  readonly remote?: (service: DeviceService) => RemoteThreadSurface
  /** The mode `open` names when no --permission-preset is given; this device's engine settings by default. Test seam. */
  readonly localPermissionPreset?: () => string
  /**
   * Where this omo's staged plugin payload lives (`<root>/plugin/extensions/` holds the gateway store's worker sidecar):
   * the npm package root by default; the compiled binary passes its provisioned runtime directory, because its own
   * module paths sit inside the executable and resolve to nothing on disk.
   */
  readonly packageRoot?: string
  /** `status` only: this device's units as its service manager reports them, read by remote-cli (omo#13594). */
  readonly localUnits?: LocalStatus
}

/** This device's real account read, local API and stdio: every dependency the local verbs need. */
export function localRemoteDependencies(packageRoot?: string): RemoteCommandDependencies {
  const stateDir = deviceServiceStateDir()
  const error = (line: string) => process.stderr.write(`${line}\n`)
  return {
    accountShow: () => readAccountInProcess(error),
    stateDir,
    ...(packageRoot === undefined ? {} : { packageRoot }),
    connect: () => connectDeviceService({ version: packageJson.version, stateDir }),
    now: () => Date.now(),
    output: (line) => process.stdout.write(`${line}\n`),
    write: (text) => process.stdout.write(text),
    error,
  }
}

async function runOn(service: DeviceService, parsed: Parsed, dependencies: RemoteCommandDependencies): Promise<number> {
  const print = (value: unknown, human: () => readonly string[]) => {
    if (parsed.json) dependencies.output(JSON.stringify(value))
    else for (const line of human()) dependencies.output(line)
    return REMOTE_EXIT.ok
  }
  switch (parsed.command) {
    case "status": {
      const status = await service.status()
      const local = dependencies.localUnits
      return print(local === undefined ? status : { ...status, local }, () =>
        statusLines(status, service.serviceVersion, local === undefined ? [] : localRows(local)),
      )
    }
    case "devices": {
      const [roster, status] = await Promise.all([service.devices(), service.status()])
      const devices = withThisDevice(roster, status)
      return print(devices, () => deviceLines(devices, dependencies.now()))
    }
    case "sessions": {
      const [result, devices, self] = await Promise.all([
        service.sessions(parsed.filter),
        service.devices(),
        service.thisDevice(),
      ])
      // A typo in --device and a device with no sessions both list nothing: name the unknown device instead.
      const wanted = parsed.filter.device
      const known = (device: string) =>
        device === self?.id ||
        devices.some((row) => row.device === device) ||
        result.rows.some((row) => row.device === device)
      if (wanted !== undefined && !known(wanted)) {
        dependencies.error(`omo remote sessions: no device ${wanted} on this account (see omo remote devices)`)
        return REMOTE_EXIT.usage
      }
      const labels = new Map(devices.map((device) => [device.device, device.label]))
      return print(result, () => sessionLines(result, labels, dependencies.now()))
    }
    case "disable": {
      const enabled = await service.setEnabled(false)
      return print({ enabled }, () => [`Remote sessions are ${enabled ? "on" : "off"} for this device.`])
    }
    case "control": {
      if (!service.capabilities.includes("control")) {
        dependencies.error(
          "The OmO device service on this device does not have remote control yet. Update OmO, then try again.",
        )
        return REMOTE_EXIT.unavailable
      }
      const state =
        parsed.control === undefined
          ? await service.attachControl()
          : await service.setAttachControl(parsed.control === "on")
      return print(state, () => controlLines(state, dependencies.now()))
    }
    case "wake": {
      // The gate is this connection's own welcome.service_version (A7R-11), never a capability word.
      if (!service.carriesWakeMark) {
        // Two causes, two answers: this build carries no wake switch yet (no update of the service enables it), or the
        // device service is older than the release that carries it (updating does).
        dependencies.error(
          service.wakeMarkMinimum === null
            ? "This build of OmO does not carry the wake switch yet."
            : "The OmO device service on this device cannot wake sessions for other devices yet. Update OmO, then try again.",
        )
        return REMOTE_EXIT.unavailable
      }
      const state =
        parsed.wake === undefined ? await service.sessionWake() : await service.setSessionWake(storedWake(parsed.wake))
      return print(state, () => wakeLines(state))
    }
    case "open":
    case "send":
    case "model":
    case "interrupt":
    case "close":
      if (parsed.session !== undefined) return runSession(service, parsed.session, parsed.json, dependencies)
      throw new UsageError(`omo remote ${parsed.command}: arguments were not parsed`)
    default:
      throw new UsageError(
        parsed.command === "" ? "omo remote: a command is required" : `omo remote: unknown command ${parsed.command}`,
      )
  }
}

// A stopped service: its socket is gone (POSIX) or its TCP endpoint refuses (Windows keeps endpoint.json).
export const isServiceStopped = (error: unknown): boolean =>
  (error instanceof Error &&
    "code" in error &&
    ["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(String(error.code))) ||
  (error instanceof LocalApiError && error.code === "handshake_timeout")

/** Runs one parsed local verb: the account notice, the device service connection, then the verb. */
export async function runLocalRemoteVerb(dependencies: RemoteCommandDependencies, parsed: Parsed): Promise<number> {
  const signedOut = await accountNotice(dependencies)
  if (signedOut !== undefined) return signedOut
  if (!existsSync(dependencies.stateDir)) {
    dependencies.error("The OmO device service is not set up on this device. Install the OmO desktop app to set it up.")
    return REMOTE_EXIT.unavailable
  }
  if (!existsSync(deviceServiceEndpointPath(dependencies.stateDir))) {
    dependencies.error("The OmO device service is not running on this device.")
    return REMOTE_EXIT.unavailable
  }
  let service: DeviceService
  try {
    service = await dependencies.connect()
  } catch (error) {
    if (isServiceStopped(error)) {
      dependencies.error("The OmO device service is not running on this device.")
      return REMOTE_EXIT.unavailable
    }
    return reportFailure(dependencies, error)
  }
  try {
    return await runOn(service, parsed, dependencies)
  } catch (error) {
    return reportFailure(dependencies, error)
  } finally {
    service.close()
  }
}

export async function accountNotice(dependencies: RemoteCommandDependencies): Promise<number | undefined> {
  const notice = accountStateNotice(classifyAccountShow(await dependencies.accountShow()))
  if (notice === undefined) return undefined
  dependencies.error(notice)
  return REMOTE_EXIT.unavailable
}

export function reportFailure(dependencies: RemoteCommandDependencies, error: unknown): number {
  if (error instanceof LocalApiError) {
    dependencies.error(`omo remote: ${error.reason}`)
    if (error.action) dependencies.error(error.action)
    return REMOTE_EXIT.failed
  }
  dependencies.error(error instanceof Error ? `omo remote: ${error.message}` : "omo remote: the operation failed")
  return REMOTE_EXIT.failed
}
