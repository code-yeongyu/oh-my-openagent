import { isAbsolute } from "node:path"

import type { SenpiExtensionAPI } from "../../../extension/types"
import { type OmoRun, type OmoRunner, omoRunner } from "./run-omo"

// TUI `/remote` (omo#13412, design v8-core r2 B5): person input inside the TUI. Each action runs ONE
// `omo remote <verb> --json` process and renders its typed answer, so the TUI, the CLI and the agent's thread tools
// reach another device's session through the same verb bodies.

type NoteType = "info" | "warning" | "error"

interface RemoteCommandUi {
  notify(message: string, type?: NoteType): void
  select?(title: string, options: string[]): Promise<string | undefined>
  input?(title: string, placeholder?: string): Promise<string | undefined>
}

const REMOTE_COMMAND_USAGE = [
  "/remote                                   pick a device, then a session, then what to do",
  "/remote status | devices",
  "/remote sessions [--device <d>] [--project <p>] [--state <s>]",
  "/remote enable | disable | control [on|off]",
  "/remote open <device> [--project <p>] [--model <m>] [--permission-preset <preset>]",
  "/remote send <device>/<session> <text>",
  "/remote interrupt | close <device>/<session>",
  "/remote model <device>/<session> <provider/id>",
  "/remote attach <device>/<session>",
].join("\n")

const PASS_THROUGH_VERBS = new Set([
  "status",
  "devices",
  "sessions",
  "enable",
  "disable",
  "control",
  "open",
  "model",
  "interrupt",
  "close",
])

// A listing, open or control answers within the CLI's own deadlines (10 s handshake, listing rounds); a waited send
// runs to the end of the remote turn, bounded by the design's total send deadline (v8-core r2 B1: 1,830,000 ms).
export const COMMAND_DEADLINE_MS = 120_000
export const SEND_DEADLINE_MS = 1_830_000

const NO_LAUNCHER =
  "/remote runs omo remote, and this session was not started by the omo launcher, so there is no omo to run. Start OmO with the omo command, or run omo remote in a terminal."

export function registerRemoteCommand(
  pi: SenpiExtensionAPI,
  options: { readonly run?: OmoRunner; readonly env?: Readonly<Record<string, string | undefined>> } = {},
): void {
  const run = options.run ?? launcherRunner(options.env ?? process.env)
  // A send still waiting for its reply when the session ends is stopped with it.
  const shutdown = new AbortController()
  pi.on("session_shutdown", () => shutdown.abort())
  pi.registerCommand("remote", {
    description: "Devices and sessions on this account's other devices: list, open, send, interrupt, attach.",
    argumentHint: "[devices|sessions|open|send|interrupt|close|attach ...]",
    handler: async (args: string, ctx: unknown) => {
      const ui = Reflect.get(Object(ctx), "ui") as RemoteCommandUi | undefined
      if (ui === undefined) return
      if (run === undefined) {
        ui.notify(NO_LAUNCHER, "error")
        return
      }
      const remote: Remote = {
        ui,
        run: (argv, deadlineMs = COMMAND_DEADLINE_MS) => run(argv, { deadlineMs, signal: shutdown.signal }),
      }
      try {
        await runRemoteCommand(remote, args)
      } catch (error) {
        failed(ui, error)
      }
    },
  })
}

function launcherRunner(env: Readonly<Record<string, string | undefined>>): OmoRunner | undefined {
  const omoBin = env["OMO_BIN"]?.trim()
  return omoBin !== undefined && omoBin !== "" && isAbsolute(omoBin) ? omoRunner(omoBin) : undefined
}

type Remote = {
  readonly ui: RemoteCommandUi
  readonly run: (argv: readonly string[], deadlineMs?: number) => Promise<OmoRun>
}

const failed = (ui: RemoteCommandUi, error: unknown): void =>
  ui.notify(`/remote: ${error instanceof Error ? error.message : String(error)}`, "error")

async function runRemoteCommand(remote: Remote, args: string): Promise<void> {
  const { ui, run } = remote
  const trimmed = args.trim()
  if (trimmed === "") return pick(remote)
  const [verb = "", ...rest] = trimmed.split(/\s+/)
  if (verb === "send") {
    const match = /^\S+\s+(\S+)\s+([\s\S]+)$/.exec(trimmed)
    if (match?.[1] === undefined || match[2] === undefined) return usage(ui, "/remote send needs a session and a text.")
    return send(remote, match[1], match[2])
  }
  if (verb === "attach") {
    const [target] = rest
    if (target === undefined || rest.length > 1) return usage(ui, "/remote attach needs one <device>/<session>.")
    return attachNotice(ui, target)
  }
  if (!PASS_THROUGH_VERBS.has(verb)) return usage(ui, verb === "help" ? undefined : `Unknown /remote command: ${verb}`)
  const answer = await run(["remote", verb, ...rest, "--json"])
  show(ui, verb, rest[0] ?? "", answer)
}

function usage(ui: RemoteCommandUi, problem: string | undefined): void {
  ui.notify(problem === undefined ? REMOTE_COMMAND_USAGE : `${problem}\n${REMOTE_COMMAND_USAGE}`, "warning")
}

function attachNotice(ui: RemoteCommandUi, target: string): void {
  ui.notify(
    `Attaching opens that session's own screen, which cannot run inside this one. In a new terminal, run:\n  omo remote attach ${target}`,
    "info",
  )
}

// The reply arrives when the remote turn ends, which can take minutes, so the TUI is not held for it: the command
// returns at once and the reply (or the failure) is shown when it lands. `/remote interrupt` ends the turn early.
function send({ ui, run }: Remote, target: string, text: string): void {
  ui.notify(`Sending to ${target}. Its reply will show here; /remote interrupt ${target} stops the turn.`, "info")
  run(["remote", "send", "--json", target, "--", text], SEND_DEADLINE_MS).then(
    (answer) => show(ui, "send", target, answer),
    (error: unknown) => failed(ui, error),
  )
}

type Device = { readonly id: string; readonly name: string; readonly online: boolean; readonly self: boolean }
type Row = { readonly target: string; readonly title: string; readonly state: string }

const OPEN_NEW = "Open a new session"
const ACTIONS = ["Send a message", "Interrupt", "Close", "Attach (new terminal)"] as const

async function pick(remote: Remote): Promise<void> {
  const { ui, run } = remote
  if (ui.select === undefined) return usage(ui, undefined)
  const devicesAnswer = await run(["remote", "devices", "--json"])
  if (!succeeded(ui, "devices", "", devicesAnswer)) return
  const devices = devicesOf(parsed(devicesAnswer))
  if (devices === undefined) return unreadable(ui, "devices", devicesAnswer)
  if (devices.length === 0) return ui.notify("No devices on this account.", "info")
  const deviceOptions = devices.map(deviceLine)
  const device = devices[deviceOptions.indexOf((await ui.select("Which device?", deviceOptions)) ?? "")]
  if (device === undefined) return
  const sessionsAnswer = await run(["remote", "sessions", "--device", device.id, "--json"])
  if (!succeeded(ui, "sessions", device.id, sessionsAnswer)) return
  const rows = rowsOf(parsed(sessionsAnswer))
  if (rows === undefined) return unreadable(ui, "sessions", sessionsAnswer)
  const rowOptions = rows.map(rowLine)
  const choice = await ui.select(`Sessions on ${device.name}`, [`${OPEN_NEW} on ${device.name}`, ...rowOptions])
  if (choice === undefined) return
  if (choice.startsWith(OPEN_NEW))
    return show(ui, "open", device.id, await run(["remote", "open", device.id, "--json"]))
  const target = rows[rowOptions.indexOf(choice)]?.target
  if (target === undefined) return
  const action = await ui.select(`${target}: what now?`, [...ACTIONS])
  if (action === "Send a message") {
    const text = await ui.input?.(`Message to ${target}`)
    if (text === undefined || text.trim() === "") return
    return send(remote, target, text)
  }
  if (action === "Interrupt") return show(ui, "interrupt", target, await run(["remote", "interrupt", target, "--json"]))
  if (action === "Close") return show(ui, "close", target, await run(["remote", "close", target, "--json"]))
  if (action === "Attach (new terminal)") attachNotice(ui, target)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function parsed(answer: OmoRun): unknown {
  const line = answer.stdout.trim().split("\n").at(-1) ?? ""
  if (line === "") return undefined
  try {
    return JSON.parse(line)
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

// Two CLI generations answer: today's session verbs nest the failure (`{kind:"error", error:{...}}`), the one-module CLI
// (#13414 part 4c) prints a flat RemoteFailure. The TUI's omo may be either, so both are read.
function typedFailure(value: unknown): string | undefined {
  if (!isRecord(value) || value["kind"] !== "error") return undefined
  const { message, next_action: next } = isRecord(value["error"]) ? value["error"] : value
  if (typeof message !== "string") return undefined
  return typeof next === "string" && next !== "" ? `${message}\n${next}` : message
}

function unreadable(ui: RemoteCommandUi, verb: string, answer: OmoRun): void {
  ui.notify(`omo remote ${verb} answered something /remote cannot read: ${answer.stdout.trim().slice(0, 200)}`, "error")
}

function stoppedLine(verb: string, target: string, ended: "deadline" | "aborted"): string | undefined {
  if (ended === "aborted") return undefined
  if (verb === "send")
    return `No reply from ${target} within ${SEND_DEADLINE_MS / 60_000} minutes, so /remote stopped waiting. The turn may still be running there: /remote interrupt ${target} stops it.`
  return `omo remote ${verb} did not answer within ${COMMAND_DEADLINE_MS / 1000} seconds and was stopped.`
}

function succeeded(ui: RemoteCommandUi, verb: string, target: string, answer: OmoRun): boolean {
  if (answer.ended !== undefined) {
    const line = stoppedLine(verb, target, answer.ended)
    if (line !== undefined) ui.notify(line, "error")
    return false
  }
  const value = parsed(answer)
  const failure = typedFailure(value)
  if (answer.code === 0 && failure === undefined) return true
  const stderr = answer.stderr.trim()
  // `enable` that stops prints {state, notice} on stdout and exits 3 (omo-native remote-bootstrap.ts): the notice says why.
  const notice = isRecord(value) && typeof value["notice"] === "string" ? value["notice"] : undefined
  ui.notify(
    failure ?? notice ?? (stderr !== "" ? stderr : `omo remote exited with code ${String(answer.code)}`),
    "error",
  )
  return false
}

function show(ui: RemoteCommandUi, verb: string, target: string, answer: OmoRun): void {
  if (!succeeded(ui, verb, target, answer)) return
  ui.notify(rendered(verb, target, parsed(answer)).join("\n"), "info")
  // A verb that succeeds can still say something on stderr (enable: device not linked, a session-host notice).
  const stderr = answer.stderr.trim()
  if (stderr !== "") ui.notify(stderr, "warning")
}

function rendered(verb: string, target: string, value: unknown): readonly string[] {
  if (verb === "devices") {
    const devices = devicesOf(value) ?? []
    return devices.length === 0 ? ["No devices on this account."] : devices.map(deviceLine)
  }
  if (verb === "sessions") {
    const rows = rowsOf(value) ?? []
    const lines = rows.length === 0 ? ["No sessions."] : rows.map(rowLine)
    const missing = unansweredOf(value)
    return missing.length === 0 ? lines : [...lines, `No answer from: ${missing.join(", ")}`]
  }
  if (verb === "status" && isRecord(value)) return statusLines(value)
  if (!isRecord(value)) return [JSON.stringify(value)]
  return sessionVerbLines(verb, target, value)
}

function unansweredOf(value: unknown): readonly string[] {
  if (!isRecord(value)) return []
  if (Array.isArray(value["unanswered"])) return (devicesOf(value["unanswered"]) ?? []).map((device) => device.name)
  return Array.isArray(value["incomplete"]) ? value["incomplete"].map(String) : []
}

function sessionVerbLines(verb: string, target: string, result: Record<string, unknown>): readonly string[] {
  if (verb === "open" && typeof result["thread"] === "string") {
    const device = result["device"]
    return [`Opened ${typeof device === "string" ? `${device}/` : ""}${result["thread"]}.`]
  }
  if (verb === "send") {
    const reply = result["reply"]
    if (typeof reply === "string" && reply !== "") return [`${target}:`, reply]
    const position = result["queue_position"]
    return typeof position === "number" ? [`Queued on ${target} at position ${position}.`] : [`Sent to ${target}.`]
  }
  if (verb === "interrupt")
    return [result["interrupted"] === true ? `Interrupted ${target}.` : `Nothing was running on ${target}.`]
  if (verb === "close") return [result["closed"] === true ? `Closed ${target}.` : `${target} was not open.`]
  if (verb === "model" && isRecord(result["model"]))
    return [`${target} now uses ${String(result["model"]["provider"])}/${String(result["model"]["id"])}.`]
  if ((verb === "enable" || verb === "disable") && typeof result["enabled"] === "boolean")
    return [`Remote sessions are ${result["enabled"] ? "on" : "off"} for this device.`]
  if (verb === "control" && typeof result["attached"] === "boolean")
    return [
      result["attached"]
        ? "Remote control is on: your other signed-in devices can view and command sessions on this device."
        : "Remote control is off: your other devices cannot view or command sessions on this device.",
    ]
  return [JSON.stringify(result)]
}

function statusLines(status: Record<string, unknown>): readonly string[] {
  const device = isRecord(status["device"]) ? status["device"]["name"] : undefined
  const lines = [
    `State: ${String(status["state"])}`,
    `Remote sessions: ${status["enabled"] === true ? "on" : "off"}`,
    `This device: ${typeof device === "string" ? device : "not set up"}`,
  ]
  const action = isRecord(status["detail"]) ? status["detail"]["action"] : undefined
  return typeof action === "string" && action !== "" ? [...lines, `Action: ${action}`] : lines
}

const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

// A device row is today's wire row (`device`, `label`) or the one-module DeviceRow (`id`, `name`, `self`).
function deviceOf(entry: unknown): Device | undefined {
  if (!isRecord(entry)) return undefined
  const id = text(entry["id"]) ?? text(entry["device"])
  if (id === undefined) return undefined
  const name = text(entry["name"]) ?? text(entry["label"]) ?? id
  return { id, name, online: entry["online"] === true, self: entry["self"] === true }
}

function devicesOf(value: unknown): readonly Device[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry: unknown) => {
    const device = deviceOf(entry)
    return device === undefined ? [] : [device]
  })
}

// A session row is today's listing row (`device` id + `session_id`) or the one-module SessionRow (`thread` handle).
function rowOf(entry: unknown): Row | undefined {
  if (!isRecord(entry)) return undefined
  const device = text(entry["device"])
  const session = text(entry["session_id"])
  const target =
    text(entry["thread"]) ?? (device !== undefined && session !== undefined ? `${device}/${session}` : undefined)
  if (target === undefined) return undefined
  return { target, title: text(entry["title"]) ?? text(entry["name"]) ?? "", state: text(entry["state"]) ?? "" }
}

function rowsOf(value: unknown): readonly Row[] | undefined {
  if (!isRecord(value) || !Array.isArray(value["rows"])) return undefined
  return value["rows"].flatMap((entry: unknown) => {
    const row = rowOf(entry)
    return row === undefined ? [] : [row]
  })
}

const deviceLine = (device: Device): string =>
  `${device.name}  ${device.id}  ${device.online ? "online" : "offline"}${device.self ? "  (this device)" : ""}`

const rowLine = (row: Row): string => `${row.target}  ${row.state}  ${row.title}`.trimEnd()
