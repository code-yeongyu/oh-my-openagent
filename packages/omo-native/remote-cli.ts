import { existsSync } from "node:fs"

import {
  type AccountShowResult,
  accountStateNotice,
  classifyAccountShow,
  type DeviceService,
  deviceServiceEndpointPath,
  LocalApiError,
  SESSION_ROW_STATES,
  type SessionRowState,
} from "../device-service-core/src/index.ts"
import type { RemoteThreadSurface } from "../omo-senpi/src/components/thread/remote/ports"
import { serveRemoteAttach } from "./remote-attach"
import { type BootstrapSetup, type DeviceLink, runBootstrapVerb, runEnableVerb } from "./remote-bootstrap"
import { applyColdWake, type ColdWake } from "./remote-cold-wake"
import { type ControlValue, type ParsedVerb, runConnectedVerb } from "./remote-connected-verbs"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import { isSessionVerb, parseSession, SESSION_VERBS } from "./remote-session-args"
import { isHelpFlag, REMOTE_USAGE, verbUsage } from "./remote-usage"

// `omo remote`: the sessions on this account's other devices, through this device's service. A thin CLI over the
// device-service SDK: every command has a human table and a --json form that prints the SDK's typed value as is.
export { REMOTE_EXIT } from "./remote-exit"

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

/** `omo remote` verbs; `bootstrap` also needs the pinned install, the stored keys and this omo binary. */
export interface RemoteVerbDependencies extends RemoteCommandDependencies {
  readonly bootstrap: BootstrapSetup
  /** The session host unit `bootstrap` and `enable` install, `disable` removes and `status` reads back (omo#13594). */
  readonly coldWake: ColdWake
  /** `enable` only: hands the signed-in session's device to a service that holds none (omo#13602). */
  readonly linkDevice: DeviceLink
}

const VERBS = ["status", "devices", "sessions", "enable", "disable", "control", "bootstrap", ...SESSION_VERBS] as const
const CONTROL_VALUES: readonly ControlValue[] = ["on", "off"]
const isControlValue = (value: string | undefined): value is ControlValue => CONTROL_VALUES.some((v) => v === value)

type Parsed = ParsedVerb

const isRowState = (value: string): value is SessionRowState =>
  (SESSION_ROW_STATES as readonly string[]).includes(value)

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

// A stopped service: its socket is gone (POSIX) or its TCP endpoint refuses (Windows keeps endpoint.json).
const isServiceStopped = (error: unknown): boolean =>
  (error instanceof Error &&
    "code" in error &&
    ["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(String(error.code))) ||
  (error instanceof LocalApiError && error.code === "handshake_timeout")

export async function runRemoteVerb(dependencies: RemoteVerbDependencies, args: readonly string[]): Promise<number> {
  // Help is an answer, not a usage error: stdout and exit 0, before anything is parsed or contacted.
  const [first, ...afterFirst] = args
  if (first === "help" || isHelpFlag(first)) {
    dependencies.output(REMOTE_USAGE)
    return REMOTE_EXIT.ok
  }
  // Only the options before a `--` terminator count: after it, `--help` is text (a message to send). The `--` terminator itself lands with #13431.
  const terminator = afterFirst.indexOf("--")
  const options = terminator === -1 ? afterFirst : afterFirst.slice(0, terminator)
  if (VERBS.some((verb) => verb === first) && options.some(isHelpFlag)) {
    dependencies.output(verbUsage(first ?? ""))
    return REMOTE_EXIT.ok
  }
  let parsed: Parsed
  try {
    parsed = parse(args)
    if (!VERBS.some((verb) => verb === parsed.command))
      throw new UsageError(parsed.command === "" ? "" : `omo remote: unknown command ${parsed.command}`)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    if (error.message) dependencies.error(error.message)
    dependencies.error(REMOTE_USAGE)
    return REMOTE_EXIT.usage
  }
  // `enable` is the one command after `omo login`: the bootstrap (install, connect, register this agent dir), the
  // switch, then the session host unit.
  if (parsed.command === "enable") {
    try {
      return await runEnableVerb(
        dependencies,
        dependencies.bootstrap,
        dependencies.coldWake,
        dependencies.linkDevice,
        parsed.json,
      )
    } catch (error) {
      return reportFailure(dependencies, error)
    }
  }
  if (parsed.command === "bootstrap")
    return (await runBootstrapVerb(dependencies, dependencies.bootstrap, dependencies.coldWake, parsed.json)) ===
      "connected"
      ? REMOTE_EXIT.ok
      : REMOTE_EXIT.unavailable
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
  let code: number
  try {
    code = await runConnectedVerb(service, parsed, dependencies, dependencies.coldWake)
  } catch (error) {
    return reportFailure(dependencies, error)
  } finally {
    service.close()
  }
  // After the connection is closed: a changed table restarts the device service, which would cut it.
  if (code === REMOTE_EXIT.ok && parsed.command === "disable")
    await applyColdWake(dependencies.coldWake, false, dependencies.error)
  return code
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
export async function prepareRemoteAttach(
  dependencies: RemoteCommandDependencies,
  args: readonly string[],
): Promise<RemoteAttachLaunch | number> {
  if (args.some(isHelpFlag)) {
    dependencies.output(verbUsage("attach"))
    return REMOTE_EXIT.ok
  }
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
    return {
      engineArgs: ["--attach", endpoint.socketPath, "--session", endpoint.sessionRef, "--no-extensions"],
    }
  } catch (error) {
    service.close()
    return reportFailure(dependencies, error)
  }
}
