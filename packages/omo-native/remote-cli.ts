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
import type { ThreadToolResult } from "../omo-senpi/src/components/thread/contracts"
import { createDeviceServiceSessions } from "../omo-senpi/src/components/thread/remote/device-service"
import type { RemoteSessionRow, RemoteThreadSurface } from "../omo-senpi/src/components/thread/remote/ports"
import { setModelRemote } from "../omo-senpi/src/components/thread/remote/remote-controls"
import {
  closeRemote,
  followRemote,
  interruptRemote,
  openRemote,
  promptRemote,
  remoteAvailable,
  type RemoteSendRequest,
  runningTurnRemote,
} from "../omo-senpi/src/components/thread/remote/remote-ops"
import { serveRemoteAttach } from "./remote-attach"
import { type BootstrapSetup, runBootstrapVerb } from "./remote-bootstrap"
import { controlLines, deviceLines, sessionLines, sessionVerbLines, statusLines } from "./remote-render"

// `omo remote`: the sessions on this account's other devices, through this device's service. A thin CLI over the
// device-service SDK: every command has a human table and a --json form that prints the SDK's typed value as is.
export const REMOTE_EXIT = { ok: 0, failed: 1, usage: 2, unavailable: 3 } as const

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

const SESSION_VERBS = ["open", "send", "model", "interrupt", "close"] as const
const VERBS = ["status", "devices", "sessions", "enable", "disable", "control", "bootstrap", ...SESSION_VERBS] as const
type SessionVerb = (typeof SESSION_VERBS)[number]
const isSessionVerb = (value: string): value is SessionVerb => SESSION_VERBS.some(verb => verb === value)
const CONTROL_VALUES = ["on", "off"] as const
type ControlValue = (typeof CONTROL_VALUES)[number]
const isControlValue = (value: string | undefined): value is ControlValue => CONTROL_VALUES.some(v => v === value)

class UsageError extends Error {}

type Parsed = {
  readonly command: string
  readonly json: boolean
  readonly filter: SessionFilter
  readonly control: ControlValue | undefined
  readonly session?: SessionArgs
}

/** `<device>/<session>`: the SESSION column of `omo remote sessions`. */
type Target = { readonly device: string; readonly session: string }

type SessionArgs =
  | { readonly verb: "open"; readonly device: string; readonly project?: string; readonly model?: string }
  | { readonly verb: "send"; readonly target: Target; readonly text: string; readonly delivery: "auto" | "steer" | "follow_up"; readonly wait: boolean }
  | { readonly verb: "model"; readonly target: Target; readonly model: string }
  | { readonly verb: "interrupt" | "close"; readonly target: Target }

function parseTarget(verb: string, value: string | undefined): Target {
  const slash = value?.indexOf("/") ?? -1
  if (value === undefined || slash <= 0 || slash === value.length - 1)
    throw new UsageError(`omo remote ${verb}: name the session as <device>/<session> (the SESSION column of omo remote sessions)`)
  return { device: value.slice(0, slash), session: value.slice(slash + 1) }
}

const SESSION_FLAGS: Readonly<Record<SessionVerb, { readonly values: readonly string[]; readonly switches: readonly string[] }>> = {
  open: { values: ["--project", "--model"], switches: [] },
  send: { values: [], switches: ["--steer", "--follow-up", "--no-wait"] },
  model: { values: [], switches: [] },
  interrupt: { values: [], switches: [] },
  close: { values: [], switches: [] },
}

function parseSession(verb: SessionVerb, rest: readonly string[]): { readonly json: boolean; readonly session: SessionArgs } {
  let json = false
  const values = new Map<string, string>()
  const switches = new Set<string>()
  const positional: string[] = []
  const { values: valueFlags, switches: switchFlags } = SESSION_FLAGS[verb]
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index] ?? ""
    if (arg === "--json") json = true
    else if (valueFlags.includes(arg)) {
      const value = rest[++index]
      if (value === undefined || value === "") throw new UsageError(`omo remote ${verb}: ${arg} needs a value`)
      values.set(arg, value)
    } else if (switchFlags.includes(arg)) switches.add(arg)
    else if (arg.startsWith("--")) throw new UsageError(`omo remote ${verb}: unknown argument ${arg}`)
    else positional.push(arg)
  }
  const arity = verb === "send" || verb === "model" ? 2 : 1
  if (positional.length > arity) throw new UsageError(`omo remote ${verb}: unknown argument ${positional[arity]}`)
  if (verb === "open") {
    const device = positional[0]
    if (device === undefined) throw new UsageError("omo remote open: the device is required (the DEVICE column of omo remote devices)")
    const project = values.get("--project")
    const model = values.get("--model")
    return { json, session: { verb, device, ...(project === undefined ? {} : { project }), ...(model === undefined ? {} : { model }) } }
  }
  const target = parseTarget(verb, positional[0])
  if (verb === "send") {
    const text = positional[1]
    if (text === undefined || text === "") throw new UsageError("omo remote send: the message text is required")
    if (switches.has("--steer") && switches.has("--follow-up")) throw new UsageError("omo remote send: pass --steer or --follow-up, not both")
    const delivery = switches.has("--steer") ? "steer" : switches.has("--follow-up") ? "follow_up" : "auto"
    return { json, session: { verb, target, text, delivery, wait: !switches.has("--no-wait") } }
  }
  if (verb === "model") {
    const model = positional[1]
    if (model === undefined || model === "") throw new UsageError("omo remote model: the model is required (provider/id)")
    return { json, session: { verb, target, model } }
  }
  return { json, session: { verb, target } }
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

// The surface the agent's thread tools reach other devices through, on this command's own connection. The chain count
// (K8) starts at its first hop: a person at a terminal is no thread chain.
const deviceServiceSurface = (service: DeviceService): RemoteThreadSurface => ({
  sessions: createDeviceServiceSessions({ version: service.serviceVersion, connect: async () => service }),
  chain: { stamp: record => record },
})

const CHAIN_START = 1

/**
 * The session verbs: each is one of the thread tools' remote ops (omo-senpi thread/remote), so the agent and this CLI
 * reach another device's session the same way. --json prints the op's typed result as is.
 */
async function runSession(service: DeviceService, args: SessionArgs, json: boolean, dependencies: RemoteCommandDependencies): Promise<number> {
  const remote = (dependencies.remote ?? deviceServiceSurface)(service)
  const show = (result: ThreadToolResult, label: string): number => {
    if (json) dependencies.output(JSON.stringify(result))
    if (result.kind === "error") {
      if (!json) {
        dependencies.error(`omo remote: ${result.error.message}`)
        dependencies.error(result.error.next_action)
      }
      return REMOTE_EXIT.failed
    }
    if (!json) for (const line of sessionVerbLines(args.verb, label, result)) dependencies.output(line)
    return REMOTE_EXIT.ok
  }
  const unavailable = await remoteAvailable(remote)
  if (unavailable !== undefined) return show(unavailable, "")
  if (args.verb === "open") {
    const opened = await openRemote(remote, { kind: "create", device: args.device, ...(args.project === undefined ? {} : { cwd: args.project }) })
    if (opened.kind !== "ok" || !("thread" in opened) || args.model === undefined) return show(opened, "")
    const created: RemoteSessionRow = { device: args.device, session_id: opened.thread.thread_id, title: opened.thread.name, project: opened.thread.cwd, path: "", state: "idle", updated_ms: 0 }
    const model = await setModelRemote(remote, created, { model: args.model })
    if (model.kind !== "ok" || !("model" in model)) return show(model, `${args.device}/${created.session_id}`)
    return show({ ...opened, model: model.model } as ThreadToolResult, "")
  }
  const label = `${args.target.device}/${args.target.session}`
  const row = (await remote.sessions.sessions()).find(candidate => candidate.device === args.target.device && candidate.session_id === args.target.session)
  if (row === undefined) {
    dependencies.error(`omo remote: no session ${label} on this account.`)
    dependencies.error("Run omo remote sessions to see them.")
    return REMOTE_EXIT.failed
  }
  switch (args.verb) {
    case "model":
      return show(await setModelRemote(remote, row, { model: args.model }), label)
    case "interrupt":
      return show(await interruptRemote(remote, row, undefined), label)
    case "close":
      return show(await closeRemote(remote, row), label)
    case "send":
      return sendTo(remote, row, args, { label, json, show }, dependencies)
  }
}

async function sendTo(
  remote: RemoteThreadSurface,
  row: RemoteSessionRow,
  args: Extract<SessionArgs, { readonly verb: "send" }>,
  { label, json, show }: { readonly label: string; readonly json: boolean; readonly show: (result: ThreadToolResult, label: string) => number },
  dependencies: RemoteCommandDependencies,
): Promise<number> {
  let request: RemoteSendRequest = { message: args.text, delivery: args.delivery }
  // A person steers whatever runs; the op still checks that turn, and the engine checks it again on arrival.
  if (args.delivery === "steer") {
    const running = await runningTurnRemote(remote, row)
    if (running.kind === "error") return show(running, label)
    if (!("turn_id" in running) || running.turn_id === undefined) {
      dependencies.error(`omo remote: nothing is running on ${label} to steer.`)
      dependencies.error("Send without --steer to start a turn.")
      return REMOTE_EXIT.failed
    }
    request = { ...request, expected_turn_id: running.turn_id }
  }
  if (!args.wait) return show(await promptRemote(remote, row, request, CHAIN_START), label)
  // Followed before the send, so no delta of the turn it starts can arrive unseen.
  let reply = ""
  const follow = await followRemote(remote, row, text => {
    reply += text
    if (!json) dependencies.write(text)
  })
  if ("kind" in follow) return show(follow, label)
  try {
    const sent = await promptRemote(remote, row, request, CHAIN_START)
    if (sent.kind === "error") return show(sent, label)
    const end = await follow.settled
    if (!json && reply.length > 0 && !reply.endsWith("\n")) dependencies.write("\n")
    // --json: the send's typed result, with the answer it streamed.
    if (json && end === "settled") dependencies.output(JSON.stringify({ ...sent, reply }))
    if (end !== "settled") {
      dependencies.error(`omo remote: the session on ${row.device} ended before its turn settled (${end}).`)
      return REMOTE_EXIT.failed
    }
    return REMOTE_EXIT.ok
  } finally {
    follow.stop()
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
