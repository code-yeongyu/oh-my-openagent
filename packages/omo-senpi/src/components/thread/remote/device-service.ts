import { connectDeviceService, LocalApiError, type CommandResult, type DeviceService, type RemoteAttach } from "@oh-my-opencode/device-service-core"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionsPort } from "./ports"

export type DeviceServiceSessionsOptions = {
  readonly version: string
  /** Test seam: the proven local API connection (the device service SDK by default). */
  readonly connect?: () => Promise<DeviceService>
}

type WireRpc = Parameters<RemoteAttach["command"]>[0]
type WireValue = WireRpc[string]

function wireValue(value: unknown): WireValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(wireValue)
  if (typeof value === "object") return wireRecord(value as Record<string, unknown>)
  throw new Error(`not a JSON value: ${typeof value}`)
}

function wireRecord(record: Readonly<Record<string, unknown>>): WireRpc {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined).map(([key, value]) => [key, wireValue(value)]))
}

// The local API codes that answer a session.command before anything leaves this device: the owner's error responses
// (dispatch outcomes arrive as session.command_state, never as an error response) and the client's own size check.
// Everything else - `closed` and `protocol_violation` can fail a command already written to the connection, and
// `internal` proves nothing about dispatch - may have run on the other device, so it is never reported as refused.
const REFUSED_BEFORE_SENDING: ReadonlySet<LocalApiError["code"]> = new Set<LocalApiError["code"]>([
  "unauthenticated", "client_proof_invalid", "invalid_request", "unknown_type", "forbidden", "owner_transfer", "signed_out",
  "device_mismatch", "device_changed", "account_changed", "device_key_invalid", "service_disabled", "sign_in_required",
  "plan_required", "activation_pending", "authorization_stale", "peer_not_found", "peer_not_session_client", "session_not_found",
  "engine_too_old", "not_attached", "command_id_conflict", "message_too_long", "upload_incomplete", "malformed",
  "method_unclassified", "method_local_only", "host_not_answering", "unsupported",
])

const notSentReason = (error: unknown): string => (error instanceof LocalApiError ? error.code : "attach_failed")

function outcomeOf(result: CommandResult): RemoteCommandOutcome {
  const { outcome } = result
  if (outcome.state === "engine_refused") return { kind: "refused", reason: outcome.reason }
  if (outcome.state === "uncertain") return { kind: "uncertain", reason: outcome.reason }
  if (outcome.state === "engine_stale") return { kind: "uncertain", reason: "engine_stale" }
  return { kind: "ok", response: result.response ?? {} }
}

/**
 * The account half of the thread tools over this device's device service: one proven connection, rebuilt after it
 * closes or fails, and one attach per remote session, dropped when it ends.
 */
export function createDeviceServiceSessions(options: DeviceServiceSessionsOptions): RemoteSessionsPort {
  let service: Promise<DeviceService> | undefined
  const attaches = new Map<string, Promise<RemoteAttach>>()
  const connect = options.connect ?? (() => connectDeviceService({ version: options.version }))
  const svc = (): Promise<DeviceService> => service ??= connect().then(
    (connected) => {
      void connected.closed.then(() => { service = undefined; attaches.clear() })
      return connected
    },
    (error: unknown) => { service = undefined; throw error },
  )
  const attach = (device: string, sessionId: string): Promise<RemoteAttach> => {
    const key = `${device}\u0000${sessionId}`
    const known = attaches.get(key)
    if (known !== undefined) return known
    const opened = svc().then((connected) => connected.attach(device, sessionId)).then(
      (attached) => { void attached.detached.then(() => attaches.delete(key)); return attached },
      (error: unknown) => { attaches.delete(key); throw error },
    )
    attaches.set(key, opened)
    return opened
  }
  return {
    status: async () => ({ state: (await (await svc()).status()).state }),
    thisDevice: async () => (await (await svc()).thisDevice())?.id ?? null,
    devices: async () => (await (await svc()).devices()).map((row) => ({ device: row.device, label: row.label, online: row.online })),
    sessions: async () => (await (await svc()).sessions()).rows.map((row) => ({ device: row.device, session_id: row.session_id, title: row.title, project: row.project, path: row.path, state: row.state, updated_ms: row.updated_ms })),
    // Relay daemon #393 adds the attach-less `session.command {device, endpoint, rpc}`; until this client carries it,
    // a session-less record on another device is refused typed instead of being sent through an unrelated attach.
    endpointCommand: async () => ({ kind: "refused", reason: "endpoint_command_unavailable" }),
    sessionCommand: async (device, sessionId, rpc) => {
      // Before the command goes out nothing can have run: an attach that fails (session_not_found, peer_not_found,
      // host_not_answering, a lost connection) or a record that is not JSON is refused with its code, typed.
      let attached: RemoteAttach
      let record: WireRpc
      try {
        record = wireRecord(rpc)
      } catch {
        return { kind: "refused", reason: "invalid_record" }
      }
      try {
        attached = await attach(device, sessionId)
      } catch (error) {
        return { kind: "refused", reason: notSentReason(error) }
      }
      try {
        return outcomeOf(await attached.command(record))
      } catch (error) {
        // Only a code that answers before sending ran nothing. Anything else - a timeout after sending, the attach or
        // connection ending, a broken protocol - may have run on the other device, so it is uncertain and never retried.
        if (error instanceof LocalApiError && error.command_id === undefined && REFUSED_BEFORE_SENDING.has(error.code)) return { kind: "refused", reason: error.code }
        return { kind: "uncertain", reason: "reply_lost" }
      }
    },
    read: async (device, sessionId, tail) => {
      // A read changes nothing on the other device, so every failure is a typed refusal, never uncertain.
      let page: Awaited<ReturnType<RemoteAttach["read"]>>
      try {
        page = await (await attach(device, sessionId)).read({ tail })
      } catch (error) {
        return { kind: "refused", reason: notSentReason(error) }
      }
      const entries: JsonObject[] = page.entries.flatMap((item) => ("entry" in item && typeof item.entry === "object" && item.entry !== null && !Array.isArray(item.entry) ? [item.entry as JsonObject] : []))
      return { kind: "ok", response: { entries } }
    },
  }
}
