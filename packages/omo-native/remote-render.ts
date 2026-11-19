import type {
  ControlAttachState,
  ControlSessionWakeState,
  Status,
  StatusState,
  UnitState,
} from "../device-service-core/src/index.ts"
import type { DeviceRow, SessionsList } from "../omo-senpi/src/components/remote/index"
import type { ThreadDelivery, ThreadToolResult } from "../omo-senpi/src/components/thread/contracts"
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
  fail_closed: "Needs repair",
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
      `Not answered, rows may be missing or cached: ${listing.unanswered.map((device) => device.name).join(", ")}`,
    )
  return lines
}

/**
 * The queued-fate line shared by the send verb's human forms (#13268). A receiver parked on an approval its person must
 * answer on that device holds the message behind it, and the line says so instead of reading as a plain queue.
 */
const queuedLine = (label: string, delivery: Extract<ThreadDelivery, { readonly queue_position: number }>): string => {
  const waitingOn = "waiting_on" in delivery ? delivery.waiting_on : undefined
  if (waitingOn?.kind === "approval")
    return `Queued on ${label} at position ${delivery.queue_position}, waiting for an approval on ${waitingOn.device ?? "that device"}.`
  return `Queued on ${label} at position ${delivery.queue_position}.`
}

/** The human answer of a session verb that succeeded; `label` is the `<device>/<session>` it named. */
export function sessionVerbLines(
  verb: "open" | "send" | "model" | "interrupt" | "close",
  label: string,
  result: ThreadToolResult,
): string[] {
  if (result.kind !== "ok") return []
  if (verb === "open" && "deduplicated" in result && "name" in result)
    return [`${result.device ?? ""}/${result.thread}`]
  if (verb === "send" && "delivery" in result) {
    const { delivery } = result
    if (delivery.kind === "queued" || delivery.kind === "queued_offline") return [queuedLine(label, delivery)]
    if (delivery.kind === "steered") return [`Steered turn ${delivery.turn_id} on ${label}.`]
    return [`Sent to ${label}: turn ${delivery.turn_id} started.`]
  }
  if (verb === "model" && "model" in result && result.model !== undefined)
    return [`${label} now uses ${result.model.provider}/${result.model.id}.`]
  if (verb === "interrupt" && "interrupted" in result) {
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
  if (verb === "close" && "closed" in result) {
    const dropped =
      "dropped_deliveries" in result && Array.isArray(result.dropped_deliveries) ? result.dropped_deliveries : []
    return [
      result.closed ? `Closed ${label}.` : `${label} was not open.`,
      ...(dropped.length === 0 ? [] : [`Dropped ${dropped.length} message(s) it had not read: ${dropped.join(", ")}.`]),
    ]
  }
  return []
}

/**
 * The wait-mode status line for a send that waits behind a running turn (#13268): stdout stays the streamed answer
 * alone, so the CLI writes this to stderr once, when the send's own reply names the position the message joined at (it
 * is not updated as the queue drains). A send that started or steered a turn answers nothing here - its answer is
 * already streaming.
 */
export function sendWaitNotice(label: string, result: ThreadToolResult): string | null {
  if (result.kind !== "ok" || !("delivery" in result)) return null
  const { delivery } = result
  return delivery.kind === "queued" || delivery.kind === "queued_offline" ? queuedLine(label, delivery) : null
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
