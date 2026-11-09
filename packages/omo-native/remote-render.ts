import type { ControlAttachState, DeviceRow, ListingResult, Status, StatusState } from "../device-service-core/src/index.ts"
import type { ThreadToolResult } from "../omo-senpi/src/components/thread/contracts"

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

export function statusLines(status: Status, serviceVersion: string): string[] {
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

export function deviceLines(devices: readonly DeviceRow[], now: number): string[] {
  if (devices.length === 0) return ["No devices on this account yet."]
  return renderTable(
    ["DEVICE", "NAME", "KIND", "PLATFORM", "SEEN"],
    devices.map(device => [device.device, device.label, device.kind, device.platform, device.online ? "online" : ago(device.last_seen_ms, now)]),
  )
}

export function sessionLines(result: ListingResult, labels: ReadonlyMap<string, string>, now: number): string[] {
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

/** The human answer of a session verb that succeeded; `label` is the `<device>/<session>` it named. */
export function sessionVerbLines(verb: "open" | "send" | "model" | "interrupt" | "close", label: string, result: ThreadToolResult): string[] {
  if (result.kind !== "ok") return []
  if (verb === "open" && "thread" in result) return [`${result.thread.device ?? ""}/${result.thread.thread_id}`]
  if (verb === "send" && "delivery" in result) {
    const { delivery } = result
    if (delivery.kind === "queued" || delivery.kind === "queued_offline") return [`Queued on ${label} at position ${delivery.queue_position}.`]
    if (delivery.kind === "steered") return [`Steered turn ${delivery.turn_id} on ${label}.`]
    return [`Sent to ${label}: turn ${delivery.turn_id} started.`]
  }
  if (verb === "model" && "model" in result) return [`${label} now uses ${result.model.provider}/${result.model.id}.`]
  if (verb === "interrupt" && "interrupted" in result) return [result.interrupted ? `Interrupted ${label}.` : `Nothing was running on ${label}.`]
  if (verb === "close" && "closed" in result) return [result.closed ? `Closed ${label}.` : `${label} was not open.`]
  return []
}

export function controlLines(state: ControlAttachState, now: number): string[] {
  const line = state.attached
    ? "Remote control is on: your other signed-in devices can view and command sessions on this device."
    : "Remote control is off: your other devices cannot view or command sessions on this device."
  return state.changedAt === "" ? [line] : [line, `Changed ${ago(Date.parse(state.changedAt), now)}.`]
}
