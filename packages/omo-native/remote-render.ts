import type {
  ControlAttachState,
  ControlSessionWakeState,
  Status,
  StatusState,
  UnitState,
} from "../device-service-core/src/index.ts"
import type { DeviceRow, FollowEvent, SendReceipt, SessionsList } from "../omo-senpi/src/components/remote/types"
import type { LocalStatus } from "./remote-cold-wake"

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
}

function renderTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)))
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd()
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

export function statusLines(
  status: Status,
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
  return rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`)
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
      device.kind,
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
      `Not answered, rows may be missing or cached: ${listing.unanswered.map((device) => device.name).join(", ")}`,
    )
  return lines
}

/**
 * The queued-fate line shared by the send verb's human forms (#13268). A receiver parked on an approval its person must
 * answer on that device holds the message behind it, and the line says so instead of reading as a plain queue.
 */
const queuedLine = (label: string, receipt: Extract<SendReceipt, { readonly queue_position: number }>): string => {
  const waitingOn = "waiting_on" in receipt ? receipt.waiting_on : undefined
  if (waitingOn?.kind === "approval")
    return `Queued on ${label} at position ${receipt.queue_position}, waiting for an approval on ${waitingOn.device ?? "that device"}.`
  return `Queued on ${label} at position ${receipt.queue_position}.`
}

/** What a session verb answered, as its human form needs it. */
export type SessionVerbAnswer =
  | { readonly verb: "open"; readonly thread: string }
  | { readonly verb: "send"; readonly thread: string; readonly receipt: SendReceipt }
  | { readonly verb: "model"; readonly thread: string; readonly model: string }
  | { readonly verb: "interrupt"; readonly thread: string; readonly interrupted: boolean }
  | { readonly verb: "close"; readonly thread: string; readonly closed: boolean }

/** The human answer of a session verb that succeeded. */
export function sessionVerbLines(answer: SessionVerbAnswer): string[] {
  const label = answer.thread
  switch (answer.verb) {
    case "open":
      return [label]
    case "send": {
      const { receipt } = answer
      if (receipt.lane === "queued" || receipt.lane === "queued_offline") return [queuedLine(label, receipt)]
      if (receipt.lane === "steered") return [`Steered turn ${receipt.turn_id ?? ""} on ${label}.`]
      return [`Sent to ${label}: turn ${receipt.turn_id ?? ""} started.`]
    }
    case "model":
      return [`${label} now uses ${answer.model}.`]
    case "interrupt":
      return [answer.interrupted ? `Interrupted ${label}.` : `Nothing was running on ${label}.`]
    case "close":
      return [answer.closed ? `Closed ${label}.` : `${label} was not open.`]
  }
}

/**
 * The wait-mode status line for a send that waits behind a running turn (#13268): stdout stays the streamed answer
 * alone, so the CLI writes this to stderr once, when the send's receipt names the position the message joined at.
 */
export function sendWaitNotice(label: string, receipt: SendReceipt): string | null {
  return receipt.lane === "queued" || receipt.lane === "queued_offline" ? queuedLine(label, receipt) : null
}

/** A followed turn waiting on an approval this client cannot answer (design v8-core r2 B3, C-05). */
export function awaitingApprovalLines(
  label: string,
  event: Extract<FollowEvent, { readonly kind: "waiting" }>,
): string[] {
  const device = label.slice(0, Math.max(0, label.indexOf("/")))
  const lines = (event.pending ?? []).map(
    (request) =>
      `omo remote: ${label} is waiting for an answer to a ${request.kind} request: ${request.title} (request ${request.request_id}).`,
  )
  if (lines.length === 0) lines.push(`omo remote: ${label} is waiting for an answer to a request.`)
  lines.push(`omo remote cannot answer it. Answer it on ${device}, where it was asked.`)
  lines.push(
    `Or stop it with omo remote interrupt ${label} or omo remote close ${label}; these end a waiting turn only on engines with that fix.`,
  )
  return lines
}

export function wakeLines(state: ControlSessionWakeState): string[] {
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

export function controlLines(state: ControlAttachState, now: number): string[] {
  const line = state.attached
    ? "Remote control is on: your other signed-in devices can view and command sessions on this device."
    : "Remote control is off: your other devices cannot view or command sessions on this device."
  return state.changedAt === "" ? [line] : [line, `Changed ${ago(Date.parse(state.changedAt), now)}.`]
}
