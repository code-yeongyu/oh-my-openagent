// Kept free of imports: the schema generator and the event schemas load this vocabulary, and must not
// pull the task engine in with it. The reader that maps a live session onto it is session-role-resolver.ts.
export const TELEMETRY_SESSION_ROLES = ["root", "child", "unknown"] as const

export type TelemetrySessionRole = (typeof TELEMETRY_SESSION_ROLES)[number]

export function parseTelemetrySessionRole(value: unknown): TelemetrySessionRole {
  return TELEMETRY_SESSION_ROLES.find((role) => role === value) ?? "unknown"
}
