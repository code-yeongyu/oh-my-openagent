import { existsSync } from "node:fs"

import {
  type AccountShowResult,
  accountStateNotice,
  classifyAccountShow,
  type DeviceService,
  deviceServiceEndpointPath,
  LocalApiError,
  SESSION_ROW_STATES,
  type SessionFilter,
  type SessionRowState,
} from "../device-service-core/src/index.ts"
import type { RemoteThreadSurface } from "../omo-senpi/src/components/thread/remote/ports"
import { serveRemoteAttach } from "./remote-attach"
import { type BootstrapSetup, runBootstrapVerb } from "./remote-bootstrap"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import { controlLines, deviceLines, sessionLines, statusLines } from "./remote-render"
import { isSessionVerb, parseSession, SESSION_VERBS, type SessionArgs } from "./remote-session-args"
import { runSession } from "./remote-session-verbs"

// `omo remote`: the sessions on this account's other devices, through this device's service. A thin CLI over the
// device-service SDK: every command has a human table and a --json form that prints the SDK's typed value as is.
export { REMOTE_EXIT } from "./remote-exit"

const REMOTE_USAGE = `usage: omo remote <command> [--json]
  status                                   the device service's connection state
  devices                                  the devices on this account
  sessions [--device D] [--project P] [--state running|idle|ended]
                                           sessions across the account's devices
  enable | disable                         turn remote sessions on or off for this device
  control [on|off]                         whether your other signed-in devices can view and command this
                                           device's sessions (on unless you turn it off)
  bootstrap                                set up this device's service for your sign-in (every omo start runs it)
  attach <device>/<session>                open a session on another device in the terminal UI, to watch and type
  open <device> [--project P] [--model M]  start a session on another device; prints <device>/<session>
  send <device>/<session> <text> [--steer|--follow-up] [--no-wait]
                                           send a message and print the answer as it arrives (--steer: into the
                                           running turn; --no-wait: return once the session took it)
  model <device>/<session> <provider/id>   switch the session's model
  interrupt <device>/<session>             stop the session's running turn
  close <device>/<session>                 end the session on its device`

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
}

/** `omo remote` verbs; `bootstrap` also needs the pinned install, the stored keys and this omo binary. */
export interface RemoteVerbDependencies extends RemoteCommandDependencies {
  readonly bootstrap: BootstrapSetup
}

const VERBS = ["status", "devices", "sessions", "enable", "disable", "control", "bootstrap", ...SESSION_VERBS] as const
const CONTROL_VALUES = ["on", "off"] as const
type ControlValue = (typeof CONTROL_VALUES)[number]
const isControlValue = (value: string | undefined): value is ControlValue => CONTROL_VALUES.some(v => v === value)

type Parsed = {
  readonly command: string
  readonly json: boolean
  readonly filter: SessionFilter
  readonly control: ControlValue | undefined
  readonly session?: SessionArgs
}

const isRowState = (value: string): value is SessionRowState => (SESSION_ROW_STATES as readonly string[]).includes(value)

function parse(args: readonly string[]): Parsed {
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
      if (control !== undefined || !isControlValue(flag)) throw new UsageError("omo remote control: the value is on or off")
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
      const labels = new Map(devices.map(device => [device.device, device.label]))
      return print(result, () => sessionLines(result, labels, dependencies.now()))
    }
    case "enable":
    case "disable": {
      const enabled = await service.setEnabled(parsed.command === "enable")
      return print({ enabled }, () => [`Remote sessions are ${enabled ? "on" : "off"} for this device.`])
    }
    case "control": {
      if (!service.capabilities.includes("control")) {
        dependencies.error("The OmO device service on this device does not have remote control yet. Update OmO, then try again.")
        return REMOTE_EXIT.unavailable
      }
      const state = parsed.control === undefined ? await service.attachControl() : await service.setAttachControl(parsed.control === "on")
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
      throw new UsageError(parsed.command === "" ? "omo remote: a command is required" : `omo remote: unknown command ${parsed.command}`)
  }
}

// A stopped service: its socket is gone (POSIX) or its TCP endpoint refuses (Windows keeps endpoint.json).
const isServiceStopped = (error: unknown): boolean =>
  (error instanceof Error && "code" in error && ["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(String(error.code))) ||
  (error instanceof LocalApiError && error.code === "handshake_timeout")

export async function runRemoteVerb(dependencies: RemoteVerbDependencies, args: readonly string[]): Promise<number> {
  let parsed: Parsed
  try {
    parsed = parse(args)
    if (!VERBS.some(verb => verb === parsed.command)) throw new UsageError(
      parsed.command === "" || parsed.command === "help" || parsed.command === "--help" ? "" : `omo remote: unknown command ${parsed.command}`,
    )
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    if (error.message) dependencies.error(error.message)
    dependencies.error(REMOTE_USAGE)
    return REMOTE_EXIT.usage
  }
  if (parsed.command === "bootstrap")
    return (await runBootstrapVerb(dependencies, dependencies.bootstrap, parsed.json)) === "connected" ? REMOTE_EXIT.ok : REMOTE_EXIT.unavailable
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

async function accountNotice(dependencies: RemoteCommandDependencies): Promise<number | undefined> {
  const notice = accountStateNotice(classifyAccountShow(await dependencies.accountShow()))
  if (notice === undefined) return undefined
  dependencies.error(notice)
  return REMOTE_EXIT.unavailable
}

function reportFailure(dependencies: RemoteCommandDependencies, error: unknown): number {
  if (error instanceof LocalApiError) {
    dependencies.error(`omo remote: ${error.reason}`)
    if (error.action) dependencies.error(error.action)
    return REMOTE_EXIT.failed
  }
  dependencies.error(error instanceof Error ? `omo remote: ${error.message}` : "omo remote: the operation failed")
  return REMOTE_EXIT.failed
}

export type RemoteAttachLaunch = { readonly engineArgs: readonly string[] }

/**
 * `omo remote attach <device>/<session>`: attaches through the device service and serves the session on a private
 * endpoint for the engine's attach TUI. Returns the engine arguments to launch, or the exit code when it cannot.
 */
export async function prepareRemoteAttach(dependencies: RemoteCommandDependencies, args: readonly string[]): Promise<RemoteAttachLaunch | number> {
  const [target, ...extra] = args
  const slash = target?.indexOf("/") ?? -1
  if (target === undefined || extra.length > 0 || slash <= 0 || slash === target.length - 1) {
    dependencies.error("usage: omo remote attach <device>/<session>   (the SESSION column of omo remote sessions)")
    return REMOTE_EXIT.usage
  }
  const device = target.slice(0, slash)
  const sessionId = target.slice(slash + 1)
  const signedOut = await accountNotice(dependencies)
  if (signedOut !== undefined) return signedOut
  if (!existsSync(dependencies.stateDir) || !existsSync(deviceServiceEndpointPath(dependencies.stateDir))) {
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
    const attach = await service.attach(device, sessionId)
    await attach.snapshot
    const endpoint = await serveRemoteAttach(attach, { label: target })
    void service.closed.then(() => endpoint.close())
    return { engineArgs: ["--attach", endpoint.socketPath, "--session", endpoint.sessionRef, "--no-extensions"] }
  } catch (error) {
    service.close()
    return reportFailure(dependencies, error)
  }
}
