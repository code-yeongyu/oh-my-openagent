import { existsSync } from "node:fs"

import { type AccountShowResult, accountStateNotice, classifyAccountShow } from "../device-service-core/src/account-state.ts"
import {
  type DeviceService,
  deviceServiceEndpointPath,
  LocalApiError,
  SESSION_ROW_STATES,
} from "../device-service-core/src/device-service.ts"
import type { SessionFilter } from "../device-service-core/src/local-api/protocol.ts"
import type { SessionRowState } from "../device-service-core/src/local-api/vocabulary.ts"
import type { RemoteThreadSurface } from "../omo-senpi/src/components/thread/remote/ports"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import { controlLines, deviceLines, sessionLines, statusLines } from "./remote-render"
import { isSessionVerb, parseSession, type SessionArgs } from "./remote-session-args"
import { runSession } from "./remote-session-verbs"

// The `omo remote` verbs whose whole call path is the account read plus this device's local API (omo#13440): argument
// parsing, the account notice, the connection, and each verb's body. `remote-cli.ts` keeps usage, `bootstrap` (a
// download) and `attach` (the engine) and delegates the rest here; nothing in this module reaches the network.

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
}

const CONTROL_VALUES = ["on", "off"] as const
type ControlValue = (typeof CONTROL_VALUES)[number]
const isControlValue = (value: string | undefined): value is ControlValue => CONTROL_VALUES.some((v) => v === value)

export type Parsed = {
  readonly command: string
  readonly json: boolean
  readonly filter: SessionFilter
  readonly control: ControlValue | undefined
  readonly session?: SessionArgs
}

const isRowState = (value: string): value is SessionRowState =>
  (SESSION_ROW_STATES as readonly string[]).includes(value)

export function parse(args: readonly string[]): Parsed {
  const [command = "", ...rest] = args
  if (isSessionVerb(command)) return { command, filter: {}, control: undefined, ...parseSession(command, rest) }
  let json = false
  const filter: { device?: string; project?: string; state?: SessionRowState } = {}
  let control: ControlValue | undefined
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]
    if (flag === "--json") {
      json = true
      continue
    }
    if (command === "control") {
      if (control !== undefined || !isControlValue(flag))
        throw new UsageError("omo remote control: the value is on or off")
      control = flag
      continue
    }
    if (command !== "sessions" || (flag !== "--device" && flag !== "--project" && flag !== "--state"))
      throw new UsageError(`omo remote ${command}: unknown argument ${flag}`)
    const value = rest[++index]
    if (value === undefined || value === "") throw new UsageError(`omo remote sessions: ${flag} needs a value`)
    if (flag === "--device") filter.device = value
    else if (flag === "--project") filter.project = value
    else if (isRowState(value)) filter.state = value
    else throw new UsageError(`omo remote sessions: --state is one of ${SESSION_ROW_STATES.join(", ")}`)
  }
  return { command, json, filter, control }
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
      return print(status, () => statusLines(status, service.serviceVersion))
    }
    case "devices": {
      const devices = await service.devices()
      return print(devices, () => deviceLines(devices, dependencies.now()))
    }
    case "sessions": {
      const [result, devices] = await Promise.all([service.sessions(parsed.filter), service.devices()])
      const labels = new Map(devices.map((device) => [device.device, device.label]))
      return print(result, () => sessionLines(result, labels, dependencies.now()))
    }
    case "enable":
    case "disable": {
      const enabled = await service.setEnabled(parsed.command === "enable")
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

