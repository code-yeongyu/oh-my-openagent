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
  SESSION_ROW_STATES,
  type SessionFilter,
  type SessionRowState,
  type Status,
} from "../device-service-core/src/device-service.ts"
import {
  exitCodeOf,
  type LocalSessions,
  type RemoteClient,
  type RemoteFailure,
  remoteClientForPerson,
} from "../omo-senpi/src/components/remote/index"
import type { RemoteThreadSurface } from "../omo-senpi/src/components/thread/remote/ports"
import { readAccountInProcess } from "./account-show"
import type { LocalStatus } from "./remote-cold-wake"
import packageJson from "./package.json" with { type: "json" }
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import { controlLines, deviceLines, localRows, sessionLines, statusLines, wakeLines } from "./remote-render"
import { isSessionVerb, parseSession, type SessionArgs } from "./remote-session-args"
import { runSession } from "./remote-session-verbs"
import { AFTER_LOGIN_FLAG } from "./remote-verbs"

// The `omo remote` verbs whose whole call path is the account read plus this device's local API (omo#13440): argument
// parsing, the account notice, the connection, and each verb's body. `remote-cli.ts` keeps usage, `bootstrap` (a
// download) and `attach` (the engine) and delegates the rest here; nothing in this module reaches the network.

export interface RemoteCommandDependencies {
  /** `omo account show`: the first bootstrap step; nothing else runs unless it reports signed in. */
  readonly accountShow: () => Promise<AccountShowResult>
  readonly stateDir: string
  readonly connect: () => Promise<DeviceService>
  /**
   * The person's remote client (design v8-core r2, L2): the read verbs make exactly one member call on it. The person
   * client over `stateDir` by default. Test seam.
   */
  readonly client?: () => RemoteClient
  /** This device's operator endpoint for the person client (its own sessions in `sessions`); remote-cli loads it. */
  readonly localSessions?: () => Promise<LocalSessions>
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

/** The person at this terminal, over this device's service: the one client every read verb uses. */
const personClient = (dependencies: RemoteCommandDependencies): RemoteClient =>
  remoteClientForPerson({
    version: packageJson.version,
    stateDir: dependencies.stateDir,
    connect: () => dependencies.connect(),
    localSessions: dependencies.localSessions,
  })

const CONTROL_VALUES = ["on", "off"] as const
type ControlValue = (typeof CONTROL_VALUES)[number]
const isControlValue = (value: string | undefined): value is ControlValue => CONTROL_VALUES.some((v) => v === value)

// omo#13037 A7.2.5: the wake switch also takes "default", which removes the stored value.
const WAKE_VALUES = ["on", "off", "default"] as const
type WakeValue = (typeof WAKE_VALUES)[number]
const isWakeValue = (value: string | undefined): value is WakeValue => WAKE_VALUES.some((v) => v === value)
const storedWake = (value: WakeValue): boolean | null => (value === "default" ? null : value === "on")

export type Parsed = {
  readonly command: string
  readonly json: boolean
  readonly filter: SessionFilter
  readonly control: ControlValue | undefined
  readonly wake?: WakeValue
  readonly session?: SessionArgs
  /** `enable` only: started by `omo login`, so an opt-out recorded meanwhile wins (remote-verbs.ts). */
  readonly afterLogin?: true
}

const isRowState = (value: string): value is SessionRowState =>
  (SESSION_ROW_STATES as readonly string[]).includes(value)

export function parse(args: readonly string[]): Parsed {
  const [command = "", ...rest] = args
  if (isSessionVerb(command)) return { command, filter: {}, control: undefined, ...parseSession(command, rest) }
  let json = false
  const filter: { device?: string; project?: string; state?: SessionRowState } = {}
  let control: ControlValue | undefined
  let wake: WakeValue | undefined
  let afterLogin = false
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]
    if (flag === "--json") {
      json = true
      continue
    }
    if (command === "enable" && flag === AFTER_LOGIN_FLAG) {
      afterLogin = true
      continue
    }
    if (command === "control") {
      if (control !== undefined || !isControlValue(flag))
        throw new UsageError("omo remote control: the value is on or off")
      control = flag
      continue
    }
    if (command === "wake") {
      if (wake !== undefined || !isWakeValue(flag))
        throw new UsageError("omo remote wake: the value is on, off or default")
      wake = flag
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
  return {
    command,
    json,
    filter,
    control,
    ...(wake === undefined ? {} : { wake }),
    ...(afterLogin ? { afterLogin: true } : {}),
  }
}

async function runOn(service: DeviceService, parsed: Parsed, dependencies: RemoteCommandDependencies): Promise<number> {
  switch (parsed.command) {
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

type Answer<T> = { readonly kind: "ok"; readonly value: T } | RemoteFailure

// The read verbs (design v8-core r2, 4c-1; Appendix A): each is ONE member call on the person client, and --json prints
// that call's value as is.
const READ_VERBS: ReadonlySet<string> = new Set(["status", "devices", "sessions", "disable", "control", "wake"])

async function runRead(client: RemoteClient, parsed: Parsed, dependencies: RemoteCommandDependencies): Promise<number> {
  const show = <T>(
    answer: Answer<T>,
    human: (value: T) => readonly string[],
    json: (value: T) => unknown = (v) => v,
  ) => {
    if (answer.kind === "error") return renderFailure(dependencies, answer, parsed.json)
    if (parsed.json) dependencies.output(JSON.stringify(json(answer.value)))
    else for (const line of human(answer.value)) dependencies.output(line)
    return REMOTE_EXIT.ok
  }
  const now = dependencies.now()
  switch (parsed.command) {
    case "status": {
      const local = dependencies.localUnits
      return show(
        await client.service.status(),
        (status) => statusLines(status, status.service_version, local === undefined ? [] : localRows(local)),
        (status) => (local === undefined ? status : { ...status, local }),
      )
    }
    case "devices":
      return show(await client.devices.list(), (devices) => deviceLines(devices, now))
    case "sessions": {
      const listed = await client.sessions.list(parsed.filter)
      // A typo in --device and a device with no sessions both used to list nothing: the client names the unknown device.
      if (listed.kind === "error" && listed.code === "not_found" && listed.details?.["kind"] === "device") {
        dependencies.error(
          `omo remote sessions: no device ${parsed.filter.device} on this account (see omo remote devices)`,
        )
        return REMOTE_EXIT.usage
      }
      return show(listed, (listing) => sessionLines(listing, now))
    }
    case "disable":
      return show(await client.service.setEnabled(false), ({ enabled }) => [
        `Remote sessions are ${enabled ? "on" : "off"} for this device.`,
      ])
    case "wake":
      return show(
        parsed.wake === undefined ? await client.service.wake() : await client.service.setWake(storedWake(parsed.wake)),
        wakeLines,
      )
    default:
      return show(
        parsed.control === undefined
          ? await client.service.control()
          : await client.service.setControl(parsed.control === "on"),
        (state) => controlLines(state, now),
      )
  }
}

const NOT_RUNNING = "The OmO device service is not running on this device."

// A next action names an SDK member (B1, R7); the CLI shows the verb that runs it.
const VERB_OF_MEMBER: Readonly<Record<string, string>> = {
  "service.status": "omo remote status",
  "devices.list": "omo remote devices",
  "sessions.list": "omo remote sessions",
}
const withVerbs = (text: string): string =>
  text.replace(/\b(service\.status|devices\.list|sessions\.list)\b/g, (member) => VERB_OF_MEMBER[member] ?? member)

/** A typed failure of the person client, printed for a person; --json also prints it as is on stdout. */
function renderFailure(dependencies: RemoteCommandDependencies, failure: RemoteFailure, json: boolean): number {
  if (json) dependencies.output(JSON.stringify(failure))
  const details = failure.details ?? {}
  if (failure.code === "host_unavailable" && details["reason"] === "service_not_installed") {
    dependencies.error(
      existsSync(dependencies.stateDir)
        ? NOT_RUNNING
        : "The OmO device service is not set up on this device. Install the OmO desktop app to set it up.",
    )
    return REMOTE_EXIT.unavailable
  }
  // The client tags a failure of the connection itself with phase "connect" (the service is not running); a failure
  // inside a member after a good connect keeps its own message below.
  if (failure.code === "host_unavailable" && details["phase"] === "connect") {
    dependencies.error(NOT_RUNNING)
    return REMOTE_EXIT.unavailable
  }
  // Two wake causes, two answers: this build carries no wake switch yet (no update of the service enables it), or the
  // device service is older than the release that carries it (updating does).
  if (failure.code === "unsupported" && details["feature"] === "wake") {
    dependencies.error(
      details["reason"] === "not_in_build"
        ? "This build of OmO does not carry the wake switch yet."
        : "The OmO device service on this device cannot wake sessions for other devices yet. Update OmO, then try again.",
    )
    return REMOTE_EXIT.unavailable
  }
  if (failure.code === "unsupported" && details["feature"] === "control") {
    dependencies.error(
      "The OmO device service on this device does not have remote control yet. Update OmO, then try again.",
    )
    return REMOTE_EXIT.unavailable
  }
  dependencies.error(`omo remote: ${failure.message}`)
  dependencies.error(withVerbs(failure.next_action))
  return exitCodeOf(failure)
}

/** Runs one parsed local verb: the account notice, then the read verb on the person client or the verb's connection. */
export async function runLocalRemoteVerb(dependencies: RemoteCommandDependencies, parsed: Parsed): Promise<number> {
  const signedOut = await accountNotice(dependencies)
  if (signedOut !== undefined) return signedOut
  if (READ_VERBS.has(parsed.command)) {
    const client = (dependencies.client ?? (() => personClient(dependencies)))()
    try {
      return await runRead(client, parsed, dependencies)
    } finally {
      client.close()
    }
  }
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
