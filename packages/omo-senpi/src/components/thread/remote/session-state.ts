import type { JsonObject, RemoteSessionState } from "./ports"

// session.detached reasons that end the access for good (relay docs/local-api.md), and the refusals a re-attach meets
// that no retry changes.
export const ACCESS_ENDED: ReadonlySet<string> = new Set(["authorization_expired", "peer_revoked", "owner_transfer", "service_disabled"])
export const ACCESS_REFUSED: ReadonlySet<string> = new Set([
  "unauthenticated", "forbidden", "owner_transfer", "signed_out", "service_disabled", "sign_in_required", "plan_required",
  "peer_not_found", "peer_not_session_client", "account_changed", "device_changed", "capability_missing", "engine_too_old",
])
export const SESSION_LEFT: ReadonlySet<string> = new Set(["session_closed", "session_replaced"])
export const SESSION_GONE: ReadonlySet<string> = new Set(["session_not_found", "unknown_session", "session_identity_mismatch"])

export const nonEmpty = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined)
export const isJsonObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value)

export function sessionStateOf(sessionId: string, data: JsonObject): RemoteSessionState {
  const questions = data["pendingQuestions"]
  const status = data["isCompacting"] === true ? "compacting" : Array.isArray(questions) && questions.length > 0 ? "waiting_input" : data["isStreaming"] === true ? "running" : "idle"
  const durableSessionId = nonEmpty(data["durableSessionId"])
  const currentTurnId = nonEmpty(data["currentTurnId"])
  // The requests the session waits on: senpi lists dialogs and questions apart; an engine that lists neither says nothing.
  const listed = [data["pendingDialogs"], questions].filter(Array.isArray)
  const pendingRequests = listed.length === 0 ? undefined : listed.flat().filter(isJsonObject)
  return {
    status,
    sessionId,
    ...(durableSessionId === undefined ? {} : { durableSessionId }),
    ...(currentTurnId === undefined ? {} : { currentTurnId }),
    ...(pendingRequests === undefined ? {} : { pendingRequests }),
  }
}

/**
 * The status a record moves the session to. A `session_status` record names it; a stream that never carried one (a
 * relay before it forwarded them) moves it by the run's lifecycle: `agent_start` runs, `agent_settled` idles.
 */
export function statusOf(record: JsonObject, sawStatusRecord: boolean): string | undefined {
  const type = record["type"]
  if (type === "session_status") return nonEmpty(record["status"])
  if (sawStatusRecord) return undefined
  return type === "agent_start" ? "running" : type === "agent_settled" ? "idle" : undefined
}

export function causeOf(record: JsonObject): string | undefined {
  const change = record["lastChange"]
  return isJsonObject(change) ? nonEmpty(change["cause"]) : undefined
}
