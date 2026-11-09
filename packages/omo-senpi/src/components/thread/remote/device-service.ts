import { connectDeviceService, LocalApiError, type CommandResult, type DeviceService, type RemoteAttach } from "@oh-my-opencode/device-service-core"
import type { JsonObject, RemoteCommandOutcome, RemoteSessionsPort } from "./ports"

export type DeviceServiceSessionsOptions = {
  readonly version: string
  /** Test seam: the proven local API connection (the device service SDK by default). */
  readonly connect?: () => Promise<DeviceService>
  /** Test seam: the wait between attaches of a just-created session while its device's listing catches up. */
  readonly retryDelay?: (ms: number) => Promise<void>
}

// A device lists a session it just created only after its next listing change, and session.attach resolves against
// that listing: live runs saw 2.5 s to 6.6 s (2026-11-06). Past this bound the create still names the session's key.
const CREATED_ATTACH_WAIT_MS = 20_000

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

// The device service refuses a session the other device does not hold with session_not_found; an engine answers a
// command for such a session unknown_session, on that device and on this one. A refusal of a session-scoped command or
// read reports the engine's code, so a remote command answers exactly what the same command does locally (#12755).
const sessionReason = (code: string): string => (code === "session_not_found" ? "unknown_session" : code)

// The engine records the thread tools send that change nothing on the other device (thread_read, the pre-send probe).
// Like the port's read, every failure of one is a typed refusal: there is nothing that may have run.
const READ_ONLY_RECORDS: ReadonlySet<string> = new Set(["get_state", "get_messages"])

// The one read a session's attach holds: its model catalog (`get_available_models`). The catalog does not change with
// what the session does, so it is held until the attach shows a new snapshot (the host re-established it) or ends, and
// is bounded in age; it only decides an exact provider/id that set_model then confirms (remote-controls.ts). Status and
// transcript reads (`get_state`, `get_messages`) are never held: the engine's in-memory state changes with no record on
// the attach (a live run held isStreaming false for 17 s of a running turn), so they always go to the device.
const CATALOG_RECORD = "get_available_models"
const CATALOG_MAX_AGE_MS = 600_000

/** One remote session's held catalog; a catalog read that a new snapshot raced is not kept. */
function createCatalogHold(attached: RemoteAttach) {
  let held: { readonly key: string; readonly response: JsonObject; readonly at: number } | undefined
  let snapshots = 0
  attached.onEvent((event) => {
    if (event.kind !== "snapshot") return
    snapshots += 1
    held = undefined
  })
  return {
    snapshots: () => snapshots,
    get: (key: string): JsonObject | undefined => (held !== undefined && held.key === key && Date.now() - held.at <= CATALOG_MAX_AGE_MS ? held.response : undefined),
    keep: (key: string, response: JsonObject, sentAt: number): void => {
      if (sentAt === snapshots) held = { key, response, at: Date.now() }
    },
  }
}

type Session = { readonly attached: RemoteAttach; readonly catalog: ReturnType<typeof createCatalogHold> }

const recordKey = (record: WireRpc): string => JSON.stringify(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

function outcomeOf(result: CommandResult): RemoteCommandOutcome {
  const { outcome } = result
  if (outcome.state === "engine_refused") return { kind: "refused", reason: outcome.reason }
  if (outcome.state === "uncertain") return { kind: "uncertain", reason: outcome.reason }
  if (outcome.state === "engine_stale") return { kind: "uncertain", reason: "engine_stale" }
  const response = result.response ?? {}
  // The engine ran the command and answered it failed (senpi's `{success: false, error, errorCode}` envelope): a typed
  // refusal, so no caller reads `data` from a failed reply.
  if (response["success"] === false) {
    const code = response["errorCode"]
    const error = response["error"]
    return { kind: "refused", reason: typeof code === "string" && code.length > 0 ? code : typeof error === "string" && error.length > 0 ? error : "engine_failed" }
  }
  return result.located === undefined ? { kind: "ok", response } : { kind: "ok", response, located: result.located.key }
}

/**
 * The account half of the thread tools over this device's device service: one proven connection, rebuilt after it
 * closes or fails, and one attach per remote session, kept across ops and dropped when it ends (the next op attaches
 * again), with the session's model catalog held on it: a command costs one round trip, and a held catalog none.
 */
export function createDeviceServiceSessions(options: DeviceServiceSessionsOptions): RemoteSessionsPort {
  let service: Promise<DeviceService> | undefined
  const attaches = new Map<string, Promise<Session>>()
  const connect = options.connect ?? (() => connectDeviceService({ version: options.version }))
  const retryDelay = options.retryDelay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const svc = (): Promise<DeviceService> => service ??= connect().then(
    (connected) => {
      void connected.closed.then(() => { service = undefined; attaches.clear() })
      return connected
    },
    (error: unknown) => { service = undefined; throw error },
  )
  const attach = (device: string, sessionId: string): Promise<Session> => {
    const key = `${device}\u0000${sessionId}`
    const known = attaches.get(key)
    if (known !== undefined) return known
    const opened = svc().then((connected) => connected.attach(device, sessionId)).then(
      (attached) => {
        void attached.detached.then(() => { if (attaches.get(key) === opened) attaches.delete(key) })
        return { attached, catalog: createCatalogHold(attached) }
      },
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
    // create / open / fork on another device: relay daemon #393's attach-less `session.command {device, endpoint, rpc}`.
    // The endpoint lookup and every refusal answered before sending ran nothing; anything after sending may have.
    endpointCommand: async (device, rpc, endpointOptions) => {
      let record: WireRpc
      try {
        record = wireRecord(rpc)
      } catch {
        return { kind: "refused", reason: "invalid_record" }
      }
      let connected: DeviceService
      try {
        connected = await svc()
      } catch (error) {
        return { kind: "refused", reason: notSentReason(error) }
      }
      try {
        return outcomeOf(await connected.endpointCommand(device, record, endpointOptions))
      } catch (error) {
        // The SDK marks a failure before session.command was written (the endpoint lookup timing out or the connection
        // closing during it) not_sent: nothing ran, so it is refused. The same codes after sending stay uncertain.
        if (error instanceof LocalApiError && error.not_sent === true) return { kind: "refused", reason: error.code }
        if (error instanceof LocalApiError && error.command_id === undefined && REFUSED_BEFORE_SENDING.has(error.code)) return { kind: "refused", reason: error.code }
        return { kind: "uncertain", reason: "reply_lost" }
      }
    },
    sessionCommand: async (device, sessionId, rpc, commandOptions) => {
      // Before the command goes out nothing can have run: an attach that fails (session_not_found, as unknown_session; peer_not_found,
      // host_not_answering, a lost connection) or a record that is not JSON is refused with its code, typed.
      let session: Session
      let record: WireRpc
      try {
        record = wireRecord(rpc)
      } catch {
        return { kind: "refused", reason: "invalid_record" }
      }
      try {
        session = await attach(device, sessionId)
      } catch (error) {
        return { kind: "refused", reason: sessionReason(notSentReason(error)) }
      }
      const { attached, catalog } = session
      const readOnly = READ_ONLY_RECORDS.has(String(rpc["type"]))
      const isCatalog = rpc["type"] === CATALOG_RECORD
      const key = recordKey(record)
      if (isCatalog && commandOptions?.fresh !== true) {
        const held = catalog.get(key)
        if (held !== undefined) return { kind: "ok", response: held, local: true }
      }
      const sentAt = catalog.snapshots()
      try {
        const outcome = outcomeOf(await attached.command(record))
        if (isCatalog && outcome.kind === "ok") catalog.keep(key, outcome.response, sentAt)
        return readOnly && outcome.kind === "uncertain" ? { kind: "refused", reason: outcome.reason } : outcome
      } catch (error) {
        // The attach succeeded, so a failure without a local API code is a lost reply, not a failed attach.
        if (readOnly) return { kind: "refused", reason: error instanceof LocalApiError ? sessionReason(error.code) : "reply_lost" }
        // Only a code that answers before sending ran nothing. Anything else - a timeout after sending, the attach or
        // connection ending, a broken protocol - may have run on the other device, so it is uncertain and never retried.
        if (error instanceof LocalApiError && error.command_id === undefined && REFUSED_BEFORE_SENDING.has(error.code)) return { kind: "refused", reason: sessionReason(error.code) }
        return { kind: "uncertain", reason: "reply_lost" }
      }
    },
    read: async (device, sessionId, tail) => {
      // A read changes nothing on the other device, so every failure is a typed refusal, never uncertain.
      let page: Awaited<ReturnType<RemoteAttach["read"]>>
      try {
        page = await (await attach(device, sessionId)).attached.read({ tail })
      } catch (error) {
        return { kind: "refused", reason: sessionReason(notSentReason(error)) }
      }
      const entries: JsonObject[] = page.entries.flatMap((item) => ("entry" in item && typeof item.entry === "object" && item.entry !== null && !Array.isArray(item.entry) ? [item.entry as JsonObject] : []))
      return { kind: "ok", response: { entries } }
    },
    watch: async (device, sessionId, listener) => {
      let attached: RemoteAttach
      try {
        attached = (await attach(device, sessionId)).attached
      } catch (error) {
        return { kind: "refused", reason: notSentReason(error) }
      }
      // onEvent replays the attach's history to a new listener before it returns: only what arrives after is delivered.
      let live = false
      const stop = attached.onEvent((event) => {
        if (live && event.kind === "records") for (const record of event.records) listener(record)
      })
      live = true
      return { kind: "ok", watch: { ended: attached.detached, stop } }
    },
    close: async () => {
      const open = service
      service = undefined
      attaches.clear()
      if (open !== undefined) (await open.catch(() => undefined))?.close()
    },
    locate: async (device, engineId, knownKey) => {
      let connected: DeviceService
      try {
        connected = await svc()
      } catch (error) {
        return { kind: "refused", reason: notSentReason(error) }
      }
      // A create reply that already names the session's listing key needs no session.locate round trip.
      let key: string
      if (knownKey !== undefined) key = knownKey
      else try {
        key = (await connected.locate(device, engineId)).key
      } catch (error) {
        return { kind: "refused", reason: error instanceof LocalApiError ? error.code : "locate_failed" }
      }
      // The session exists under `key` from here on; wait (bounded) until the listing names it so the next command's
      // attach finds it, and keep that attach for it.
      const deadline = Date.now() + CREATED_ATTACH_WAIT_MS
      for (let wait = 250; ; wait = Math.min(wait * 2, 2_000)) {
        try {
          await attach(device, key)
          break
        } catch (error) {
          if (!(error instanceof LocalApiError && error.code === "session_not_found") || Date.now() + wait > deadline) break
          await retryDelay(wait)
        }
      }
      return { kind: "ok", sessionId: key }
    },
  }
}
