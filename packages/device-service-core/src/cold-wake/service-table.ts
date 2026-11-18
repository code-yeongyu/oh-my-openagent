import { SESSION_HOST_LAUNCHD_LABEL, SESSION_HOST_SYSTEMD_UNIT } from "./session-host-unit.ts"

// The device service's launch-time service table (read once at its start) and the one entry it starts for a cold wake.
// omo owns only that entry: every other entry is kept as written, and a table that does not parse is never rewritten.
export const SERVICE_TABLE_ENV = "OMO_RELAYD_SERVICES"
const COLD_WAKE_SERVICE = "omo"

export type ServicePlatform = "linux" | "darwin"

/** `value` undefined: the table is empty after the edit, so the variable goes away. */
export type TableEdit =
  | { readonly kind: "unchanged" }
  | { readonly kind: "changed"; readonly value: string | undefined }
  | { readonly kind: "invalid"; readonly reason: string }

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

// `senders: []`: no device may restart the session host through service.restart; a cold wake needs no sender list.
const coldWakeEntry = (platform: ServicePlatform) =>
  platform === "darwin"
    ? { launchd: SESSION_HOST_LAUNCHD_LABEL, senders: [] }
    : { systemd_user: SESSION_HOST_SYSTEMD_UNIT, senders: [] }

const parseTable = (raw: string | undefined): Readonly<Record<string, unknown>> | { readonly invalid: string } => {
  if (raw === undefined || raw.trim() === "") return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { invalid: "the table is not valid JSON" }
  }
  return isRecord(parsed) ? parsed : { invalid: "the table is not a JSON object" }
}

const isInvalid = (table: object): table is { readonly invalid: string } =>
  "invalid" in table && typeof table.invalid === "string" && Object.keys(table).length === 1

export const withColdWake = (raw: string | undefined, platform: ServicePlatform): TableEdit => {
  const table = parseTable(raw)
  if (isInvalid(table)) return { kind: "invalid", reason: table.invalid }
  const entry = coldWakeEntry(platform)
  if (JSON.stringify(table[COLD_WAKE_SERVICE]) === JSON.stringify(entry)) return { kind: "unchanged" }
  return { kind: "changed", value: JSON.stringify({ ...table, [COLD_WAKE_SERVICE]: entry }) }
}

export const withoutColdWake = (raw: string | undefined): TableEdit => {
  const table = parseTable(raw)
  if (isInvalid(table)) return { kind: "invalid", reason: table.invalid }
  if (!(COLD_WAKE_SERVICE in table)) return { kind: "unchanged" }
  const rest = Object.fromEntries(Object.entries(table).filter(([name]) => name !== COLD_WAKE_SERVICE))
  return { kind: "changed", value: Object.keys(rest).length === 0 ? undefined : JSON.stringify(rest) }
}
