import { existsSync } from "node:fs"

import {
  type AccountShowResult,
  accountStateNotice,
  classifyAccountShow,
  connectDeviceService,
  type DeviceRow,
  type DeviceService,
  deviceServiceEndpointPath,
  deviceServiceStateDir,
  type ListingResult,
  LocalApiError,
  SESSION_ROW_STATES,
  type SessionFilter,
  type SessionRowState,
  type Status,
  type StatusState,
} from "../device-service-core/src/index.ts"
import { resolveMemoryRoot } from "../memory-core/src/identity/layout"
import { syncPinDir } from "../memory-core/src/sync/pin-dir"
import { createCredentialStore, type CredentialStore, SESSION_READ_WAIT } from "../omo-opencode/src/cli/service-auth/keystore"
import { serviceOrigin } from "../omo-opencode/src/cli/service-auth/protocol"
import { runAccountVerb } from "./account-cli"
import packageJson from "./package.json" with { type: "json" }
import { serveRemoteAttach } from "./remote-attach"

// `omo remote`: the sessions on this account's other devices, through this device's service. A thin CLI over the
// device-service SDK: every command has a human table and a --json form that prints the SDK's typed value as is.
export const REMOTE_EXIT = { ok: 0, failed: 1, usage: 2, unavailable: 3 } as const

const REMOTE_USAGE = `usage: omo remote <command> [--json]
  status                                   the device service's connection state
  devices                                  the devices on this account
  sessions [--device D] [--project P] [--state running|idle|ended]
                                           sessions across the account's devices
  enable | disable                         turn remote sessions on or off for this device
  attach <device>/<session>                watch a session on another device (input is not enabled yet)`

export interface RemoteCommandDependencies {
  /** `omo account show`: the first bootstrap step; nothing else runs unless it reports signed in. */
  readonly accountShow: () => Promise<AccountShowResult>
  readonly stateDir: string
  readonly connect: () => Promise<DeviceService>
  readonly now: () => number
  readonly output: (line: string) => void
  readonly error: (line: string) => void
}

const STATE_LABELS: Readonly<Record<StatusState, string>> = {
  not_configured: "Not set up",
  disabled: "Off",
  sign_in_required: "Sign-in required",
  plan_required: "Plan required",
  keychain_locked: "Keychain locked",
  connecting: "Connecting",
  activation_pending: "Waiting for activation",
  connected: "Connected",
  offline: "Offline",
  authorization_stale: "Reconnecting",
  service_degraded: "Needs attention",
  update_required: "Update required",
  signed_out: "Signed out",
}

class UsageError extends Error {}

type Parsed = { readonly command: string; readonly json: boolean; readonly filter: SessionFilter }

const isRowState = (value: string): value is SessionRowState => (SESSION_ROW_STATES as readonly string[]).includes(value)

function parse(args: readonly string[]): Parsed {
  const [command = "", ...rest] = args
  let json = false
  const filter: { device?: string; project?: string; state?: SessionRowState } = {}
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]
    if (flag === "--json") {
      json = true
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
  return { command, json, filter }
}

function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map(row => (row[column] ?? "").length)))
  const line = (cells: readonly string[]) => cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd()
  return [line(header), ...rows.map(line)]
}

export function ago(ms: number | null, now: number): string {
  if (ms === null) return "never"
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function statusLines(status: Status, serviceVersion: string): string[] {
  const rows: [string, string][] = [
    ["State", STATE_LABELS[status.state]],
    ["Remote sessions", status.enabled ? "on" : "off"],
    ["This device", status.device === null ? "not set up" : status.device.name],
    ["Service", serviceVersion],
  ]
  if (status.detail?.action) rows.push(["Action", status.detail.action])
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`)
}

function deviceLines(devices: readonly DeviceRow[], now: number): string[] {
  if (devices.length === 0) return ["No devices on this account yet."]
  return renderTable(
    ["DEVICE", "NAME", "KIND", "PLATFORM", "SEEN"],
    devices.map(device => [device.device, device.label, device.kind, device.platform, device.online ? "online" : ago(device.last_seen_ms, now)]),
  )
}

function sessionLines(result: ListingResult, labels: ReadonlyMap<string, string>, now: number): string[] {
  const lines =
    result.rows.length === 0
      ? ["No sessions found."]
      : renderTable(
          ["SESSION", "TITLE", "STATE", "PROJECT", "DEVICE", "UPDATED"],
          result.rows.map(row => [
            `${row.device}/${row.session_id}`,
            row.title,
            row.source === "cache" ? `${row.state} (cached)` : row.state,
            row.project,
            labels.get(row.device) ?? row.device,
            ago(row.updated_ms, now),
          ]),
        )
  const missing = [
    ...new Set([...result.incomplete, ...Object.entries(result.devices).filter(([, state]) => state !== "answered").map(([device]) => device)]),
  ]
  if (missing.length > 0)
    lines.push("", `Not answered, rows may be missing or cached: ${missing.map(device => labels.get(device) ?? device).join(", ")}`)
  return lines
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
    default:
      throw new UsageError(parsed.command === "" ? "omo remote: a command is required" : `omo remote: unknown command ${parsed.command}`)
  }
}

// A stopped service: its socket is gone (POSIX) or its TCP endpoint refuses (Windows keeps endpoint.json).
const isServiceStopped = (error: unknown): boolean =>
  (error instanceof Error && "code" in error && ["ENOENT", "ECONNREFUSED", "ECONNRESET"].includes(String(error.code))) ||
  (error instanceof LocalApiError && error.code === "handshake_timeout")

export async function runRemoteVerb(dependencies: RemoteCommandDependencies, args: readonly string[]): Promise<number> {
  let parsed: Parsed
  try {
    parsed = parse(args)
    if (!["status", "devices", "sessions", "enable", "disable"].includes(parsed.command)) throw new UsageError(
      parsed.command === "" || parsed.command === "help" || parsed.command === "--help" ? "" : `omo remote: unknown command ${parsed.command}`,
    )
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    if (error.message) dependencies.error(error.message)
    dependencies.error(REMOTE_USAGE)
    return REMOTE_EXIT.usage
  }
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

async function inProcessAccountShow(): Promise<AccountShowResult> {
  const api = serviceOrigin(process.env.OMO_SERVICE_API_URL ?? "https://api.omo.dev")
  const lines: string[] = []
  let store: CredentialStore | undefined
  const exitCode = await runAccountVerb(
    {
      api,
      get store() {
        store ??= createCredentialStore(api, { wait: SESSION_READ_WAIT })
        return store
      },
      pinDir: () => syncPinDir(resolveMemoryRoot(process.env, process.cwd())),
      readStdin: async () => "",
      output: line => lines.push(line),
      error: () => {},
    },
    ["show"],
  )
  return { exitCode, stdout: lines.join("\n") }
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

function remoteDependencies(): RemoteCommandDependencies {
  const stateDir = deviceServiceStateDir()
  return {
    accountShow: inProcessAccountShow,
    stateDir,
    connect: () => connectDeviceService({ version: packageJson.version, stateDir }),
    now: () => Date.now(),
    output: line => process.stdout.write(`${line}\n`),
    error: line => process.stderr.write(`${line}\n`),
  }
}

/** The launchers' entry for `omo remote attach`: the engine argv to run in place of this command, or undefined (exit code set). */
export async function runRemoteAttachCommand(args: readonly string[]): Promise<readonly string[] | undefined> {
  const prepared = await prepareRemoteAttach(remoteDependencies(), args.slice(2))
  if (typeof prepared === "number") {
    process.exitCode = prepared
    return undefined
  }
  return prepared.engineArgs
}

export async function runRemoteCommand(args: readonly string[]): Promise<void> {
  process.exitCode = await runRemoteVerb(remoteDependencies(), args.slice(1))
}
