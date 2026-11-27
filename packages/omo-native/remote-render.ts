import type {
  ControlState,
  DeviceRow,
  InterruptResult,
  RemoteClient,
  SendReceipt,
  ServiceStatus,
  SessionsList,
} from "../omo-senpi/src/components/remote/index"
import type { LocalStatus } from "./remote-cold-wake"
import { escapeForDisplay } from "@oh-my-opencode/utils/escape-for-display"

type StatusState = ServiceStatus["state"]
type UnitState = LocalStatus["device_service"]["state"]
type WakeState = Extract<Awaited<ReturnType<RemoteClient["service"]["wake"]>>, { readonly kind: "ok" }>["value"]

// The human forms of `omo remote`; every command also has a --json form that prints the SDK's typed value as is.
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
  fail_closed: "Needs repair",
}

function renderTable(header: readonly string[], shownRows: readonly (readonly string[])[]): string[] {
  const rows = shownRows.map((row) => row.map((cell) => escapeForDisplay(cell)))
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)))
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd()
  return [line(header), ...rows.map(line)]
}

const textOf = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)
const isEntry = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

/**
 * The candidates of a typed refusal (an ambiguous device, name or prefix), one per line - the address or device id a
 * person can type back, then its name (#14305 review M4). A refusal with no candidates prints nothing, and neither does a
 * device_offline refusal: an offline device is the one device the person named, not a choice (its typed details keep
 * the candidates for a caller that reads data).
 */
export function candidateLines(refusal: {
  readonly code: string
  readonly details?: Readonly<Record<string, unknown>> | undefined
}): string[] {
  if (refusal.code === "device_offline") return []
  const listed: unknown = refusal.details?.["candidates"]
  if (!Array.isArray(listed)) return []
  return listed.filter(isEntry).flatMap((candidate) => {
    const id = textOf(candidate["address"]) ?? textOf(candidate["device"]) ?? textOf(candidate["thread"])
    const name = textOf(candidate["device_name"]) ?? textOf(candidate["name"])
    return id === undefined ? [] : [escapeForDisplay(`  ${id}${name === undefined ? "" : `  ${name}`}`)]
  })
}

// A refusal's next action may name the agents' eval-only thread_list tool; a person at a terminal runs the CLI verb.
export const personNextAction = (text: string): string =>
  /\bthread_list\b/.test(text) ? "Run omo remote sessions to see the account's sessions." : text

/** A typed refusal as the lines a person reads on stderr: the message, the next action, then any candidates. */
export function refusalLines(refusal: {
  readonly code: string
  readonly message: string
  readonly next_action: string
  readonly details?: Readonly<Record<string, unknown>> | undefined
}): string[] {
  return [
    escapeForDisplay(`omo remote: ${refusal.message}`),
    escapeForDisplay(personNextAction(refusal.next_action)),
    ...candidateLines(refusal),
  ]
}

/** `omo remote open --prompt` whose session opened but whose first prompt was not delivered. */
export function undeliveredPromptLines(
  label: string,
  error: { readonly message: string; readonly next_action: string },
): string[] {
  return [
    escapeForDisplay(`omo remote: opened ${label}, but its first prompt was not delivered: ${error.message}`),
    escapeForDisplay(`${error.next_action} Send it again with omo remote send ${label} <text>.`),
  ]
}

export const sessionEndedLine = (device: string, end: string): string =>
  escapeForDisplay(`omo remote: the session on ${device} ended before its turn settled (${end}).`)

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

export function statusLines(
  status: Omit<ServiceStatus, "service_version">,
  serviceVersion: string,
  local: readonly (readonly [string, string])[] = [],
): string[] {
  const rows: (readonly [string, string])[] = [
    ["State", STATE_LABELS[status.state]],
    ["Remote sessions", status.enabled ? "on" : "off"],
    ["This device", status.device === null ? "not set up" : status.device.name],
    ["Service", serviceVersion],
  ]
  if (status.detail?.action) rows.push(["Action", status.detail.action])
  rows.push(...local)
  const width = Math.max(...rows.map(([label]) => label.length))
  return rows.map(([label, value]) => escapeForDisplay(`${label.padEnd(width)}  ${value}`))
}

const UNIT_STATE_LABELS: Readonly<Record<UnitState, string>> = {
  running: "running",
  stopped: "stopped",
  not_installed: "not installed",
  unknown: "unknown",
}

const yesNoUnknown = (value: boolean | "unknown", yes: string, no: string): string =>
  value === "unknown" ? "unknown" : value ? yes : no

/** `omo remote status` rows for this device's own units, as its service manager reports them (omo#13594). */
export function localRows(local: LocalStatus): (readonly [string, string])[] {
  const host = local.session_host
  const hostDetail =
    host.state === "not_installed"
      ? UNIT_STATE_LABELS[host.state]
      : [
          UNIT_STATE_LABELS[host.state],
          host.enabled ? "enabled" : "not enabled",
          yesNoUnknown(host.pinned, "pinned", "not pinned"),
        ].join(", ")
  return [
    ["Session host", `${hostDetail} (${host.unit})`],
    ["Service unit", `${UNIT_STATE_LABELS[local.device_service.state]} (${local.device_service.unit})`],
    ["Cold wake", yesNoUnknown(local.cold_wake_entry, "on", "off")],
    // The service has no read for registered agent dirs yet; this is the one every omo start and `enable` register.
    ["Agent dir", `${local.agent_dir} (registered at every omo start)`],
  ]
}

export function deviceLines(devices: readonly DeviceRow[], now: number): string[] {
  if (devices.length === 0) return ["No devices on this account yet."]
  return renderTable(
    ["DEVICE", "NAME", "KIND", "PLATFORM", "SEEN"],
    devices.map((device) => [
      device.id,
      device.name,
      device.kind ?? "this device",
      device.platform,
      device.online ? "online" : ago(device.last_seen_ms, now),
    ]),
  )
}

export function sessionLines(listing: SessionsList, now: number): string[] {
  const lines =
    listing.rows.length === 0
      ? ["No sessions found."]
      : renderTable(
          ["SESSION", "TITLE", "STATE", "PROJECT", "DEVICE", "UPDATED"],
          listing.rows.map((row) => [
            row.thread,
            row.title,
            row.source === "cache" ? `${row.state} (cached)` : row.state,
            row.project,
            row.device.name,
            ago(row.updated_ms, now),
          ]),
        )
  if (listing.unanswered.length > 0)
    lines.push(
      "",
      escapeForDisplay(
        `Not answered, rows may be missing or cached: ${listing.unanswered.map((device) => device.name).join(", ")}`,
      ),
    )
  return lines
}

/**
 * The queued-fate line of a send (#13268). A receiver parked on an approval its person must answer on that device holds
 * the message behind it, and the line says so instead of reading as a plain queue.
 */
const queuedLine = (label: string, receipt: Extract<SendReceipt, { readonly queue_position: number }>): string => {
  const waitingOn = "waiting_on" in receipt ? receipt.waiting_on : undefined
  if (waitingOn?.kind === "approval")
    return `Queued on ${label} at position ${receipt.queue_position}, waiting for an approval on ${waitingOn.device ?? "that device"}.`
  return `Queued on ${label} at position ${receipt.queue_position}.`
}

/** The human answer of a send that did not wait; `label` is the session as its address names it. */
export function sendLines(label: string, receipt: SendReceipt): string[] {
  if (receipt.lane === "queued" || receipt.lane === "queued_offline")
    return [escapeForDisplay(queuedLine(label, receipt))]
  if (receipt.lane === "steered") return [escapeForDisplay(`Steered turn ${receipt.turn_id ?? "?"} on ${label}.`)]
  return [escapeForDisplay(`Sent to ${label}: turn ${receipt.turn_id ?? "?"} started.`)]
}

/** The human answer of an interrupt: what ran, and the background jobs of its turn it stopped or left (#13444). */
export const interruptLines = (label: string, result: InterruptResult): string[] =>
  interruptVerbLines(label, result).map((line) => escapeForDisplay(line))

function interruptVerbLines(label: string, result: InterruptResult): string[] {
  if (!result.interrupted) return [`Nothing was running on ${label}.`]
  const { background } = result
  if (background.status === "not_supported")
    return [
      `Interrupted ${label}.`,
      `Background jobs that turn started were left running: the engine on ${label} cannot stop them.`,
    ]
  const jobName = (job: { readonly id: string; readonly description?: string }) => job.description ?? job.id
  const count = background.stopped.length
  return [
    `Interrupted ${label}.`,
    ...(count === 0
      ? []
      : [`Stopped ${count} background job${count === 1 ? "" : "s"}: ${background.stopped.map(jobName).join(", ")}.`]),
    ...background.failed.map((job) => `Could not stop background job ${jobName(job)}: ${job.reason}.`),
  ]
}

/** The human answer of a close, with the messages it dropped (omo#14234). */
export function closeLines(
  label: string,
  closed: { readonly closed: boolean; readonly dropped_deliveries: readonly string[] },
): string[] {
  const dropped = closed.dropped_deliveries
  return [
    closed.closed ? `Closed ${label}.` : `${label} was not open.`,
    ...(dropped.length === 0 ? [] : [`Dropped ${dropped.length} message(s) it had not read: ${dropped.join(", ")}.`]),
  ].map((line) => escapeForDisplay(line))
}

/** The human answer of a model change: the model the session now uses. */
export const modelLines = (label: string, model: string): string[] => [escapeForDisplay(`${label} now uses ${model}.`)]

/** The human answer of an open: the new session's address. */
export const openedLines = (address: string): string[] => [escapeForDisplay(address)]

/**
 * The wait-mode status line for a send that waits behind a running turn (#13268): stdout stays the streamed answer
 * alone, so the CLI writes this to stderr once, when the send's receipt names the position the message joined at (it is
 * not updated as the queue drains). A send that started or steered a turn answers nothing here - its answer is already
 * streaming.
 */
export function sendWaitNotice(label: string, receipt: SendReceipt): string | null {
  return receipt.lane === "queued" || receipt.lane === "queued_offline" ? queuedLine(label, receipt) : null
}

export function wakeLines(state: WakeState): string[] {
  const line = state.enabled
    ? "Waking is on: sessions on this device that are not running may be started by a message from your other signed-in devices."
    : "Waking is off: a message from another device waits until this session is opened here."
  const source =
    state.stored === null
      ? "Nothing is stored for this device, so it follows this build's default."
      : state.stored === "unreadable"
        ? "The stored value could not be read; set it again to repair it."
        : `Stored on this device: ${state.stored ? "on" : "off"}.`
  const lines = [line, source]
  if (state.overridden)
    lines.push("This run of the device service cannot wake sessions for other devices whatever the switch says.")
  return lines
}

export function controlLines(state: ControlState, now: number): string[] {
  const line = state.attached
    ? "Remote control is on: your other signed-in devices can view and command sessions on this device."
    : "Remote control is off: your other devices cannot view or command sessions on this device."
  return state.changedAt === "" ? [line] : [line, `Changed ${ago(Date.parse(state.changedAt), now)}.`]
}
