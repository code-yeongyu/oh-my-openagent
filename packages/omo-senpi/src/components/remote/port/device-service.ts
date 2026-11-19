import { outcomeOf } from "../../thread/remote/outcome"
import {
  connectDeviceService,
  LocalApiError,
  NoPrimaryEndpointError,
  NotSentError,
  UnsettledCommandError,
  REFUSED_BEFORE_SENDING,
  WAKE_ACCEPTS,
  type DeviceService,
  type EndpointCommandResult,
  type RemoteAttach,
} from "@oh-my-opencode/device-service-core/device-service"
import { createAttachPool, HELD_RECORDS, type HeldAttach } from "../../thread/remote/attach-pool"
import type {
  DeviceServiceDial,
  JsonObject,
  RemoteCommandOutcome,
  RemoteListing,
  RemoteSessionsPort,
} from "../../thread/remote/ports"
import { openSessionWatch } from "../../thread/remote/remote-watch"
import { commandWaitMs, withinCallBudget } from "../../call-budget/call-deadline"
import { createListingRound } from "./listing-round"

export type DeviceServiceSessionsOptions = {
  readonly version: string
  /** Test seam: the dialer of the long-lived connection (the device service SDK by default, owned). */
  readonly connect?: DeviceServiceDial
  /** Test seam: the dialer endpoint commands ride on; the connect dialer by default. */
  readonly dialEndpoint?: DeviceServiceDial
  /** Test seam: the client's own cap on one single-probe locate (LOOKUP_CAP_MS). */
  readonly lookupCapMs?: number
  /**
   * Test seam: the wait between attaches of a just-created session while its device's listing catches up, and between
   * a watch's re-attaches.
   */
  readonly retryDelay?: (ms: number) => Promise<void>
  /** Test seam: how long an attach no op or watch holds is kept before it is detached. */
  readonly attachIdleMs?: number
  /** Test seam: the clock that ages a finished account listing. */
  readonly now?: () => number
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
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, wireValue(value)]),
  )
}

const notSentReason = (error: unknown): string => (error instanceof LocalApiError ? error.code : "attach_failed")

// The device service refuses a session the other device does not hold with session_not_found; an engine answers a
// command for such a session unknown_session, on that device and on this one. A refusal of a session-scoped command or
// read reports the engine's code, so a remote command answers exactly what the same command does locally (#12755).
const sessionReason = (code: string): string => (code === "session_not_found" ? "unknown_session" : code)

// The engine records the thread tools send that change nothing on the other device (thread_read and its paged form,
// the pre-send probe). Like the port's read, every failure of one is a typed refusal: there is nothing that may have run.
const READ_ONLY_RECORDS: ReadonlySet<string> = new Set([
  "get_state",
  "get_messages",
  "get_entries",
  "get_protocol_info",
])

// How long a read-only record waits for its final state before it is refused request_timeout (the local API's own request
// bound). Every other record keeps the attach's default bound: a lost final state never holds a tool call forever.
const READ_WAIT_MS = 30_000

// omo#14130: every other record's wait, below the 60 s a host-tool bridge gives a tool call (the attach's own default is
// 120 s). A command that outlives it after it left this device answers delivered_unconfirmed, never a bare timeout.
const SEND_WAIT_MS = 45_000

// omo#13037 A6: only a peer delivery carries the wake mark, and only through a service that carries it.
const MARKED_RECORDS: ReadonlySet<string> = new Set(["admit_external_message"])

// A single-probe locate that ran and found nothing: the device answered and holds no such session. Any other failure
// means the device did not answer within the bound (or could not be reached), so the lookup counts it as silent.
const LOOKUP_NONE: ReadonlySet<string> = new Set(["session_not_found", "peer_not_found", "peer_not_session_client"])

// A kept endpoint key the device no longer lists: its synchronous refusal (this device's service answers a command to an
// endpoint key no listing names `unsupported`, with no command id: nothing was sent) or the device's `route_unlisted`.
const UNLISTED_ENDPOINT: RemoteCommandOutcome = { kind: "refused", reason: "route_unlisted" }
const unlistedEndpointError = (error: unknown): boolean =>
  error instanceof LocalApiError && error.command_id === undefined && error.code === "unsupported"

const recordKey = (record: WireRpc): string =>
  JSON.stringify(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/**
 * The account half of the thread tools over this device's device service: one proven connection, rebuilt after it
 * closes or fails, and one attach per remote session, kept across ops and dropped when it ends (the next op attaches
 * again), with the session's model catalog held on it: a command costs one round trip, and a held catalog none.
 */
// The listing's optional durable_id (device-service-core #12996); a daemon or core that predates it lists none.
function durableIdOf(row: object): { readonly durable_id?: string } {
  const value = Reflect.get(row, "durable_id")
  return typeof value === "string" && value !== "" ? { durable_id: value } : {}
}

// omo#13037 A4.3.3: the service bounds a single-probe locate at 3 s; the client holds its own cap so a send's bound does
// not rest on the service honouring it. A device past the cap counts as silent.
const LOOKUP_CAP_MS = 3_500

/**
 * Attaches to a session another device holds, by the address a caller typed. A thread is addressed by its durable id
 * (decision 0027 D2), which the device's listing may not name yet for a session it opened a moment ago: an attach refused
 * session_not_found locates the id once and attaches on the key the device names (omo#13748, omo#13707; measured over
 * the relay as `omo remote open` then `omo remote model <device>/<id>` answering no session). A durable id (a UUID) is
 * never sent to session.attach: the device service refuses it invalid_request (relay-daemon#1350; before that the
 * attach crashed the service), so it is located first and attached on the key the device names. Any other address is
 * attached as typed and located once when the attach refuses it (session_not_found, or invalid_request from a service
 * with #1350). A locate that cannot answer leaves the attach's own refusal as the answer. The thread tools' port and
 * `omo remote attach` both use it.
 */
export async function attachAddressed(
  connected: DeviceService,
  device: string,
  sessionId: string,
): Promise<{ readonly attached: RemoteAttach; readonly key: string }> {
  const on = async (key: string) => ({ attached: await connected.attach(device, key), key })
  const locate = () =>
    Promise.resolve()
      .then(() => connected.locate(device, sessionId))
      .catch((error: unknown) => {
        // A locate that answered "none" is the answer: the address names no session there (not the attach's refusal).
        if (error instanceof LocalApiError && error.code === "session_not_found") throw error
        return undefined
      })
  if (DURABLE_ID.test(sessionId)) {
    // Only a locate that answered "none" means the session is gone; any other failure (b not answering, a lost connection)
    // is the refusal as it came, so a close never reports a running session not_live (review M1 of 6ce7397).
    return await on((await connected.locate(device, sessionId)).key)
  }
  try {
    return await on(sessionId)
  } catch (error) {
    if (!(error instanceof LocalApiError && (error.code === "session_not_found" || error.code === "invalid_request")))
      throw error
    const located = await locate()
    if (located === undefined || located.key === sessionId) throw error
    return await on(located.key)
  }
}

// The shape of an omo durable session id (a UUID, v7 in practice); a device's listing key is never one.
const DURABLE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createDeviceServiceSessions(options: DeviceServiceSessionsOptions): RemoteSessionsPort {
  let service: Promise<{ readonly conn: DeviceService; readonly owned: boolean }> | undefined
  const connect =
    options.connect ??
    (async () => ({ conn: await connectDeviceService({ version: options.version }), owned: true as const }))
  const dialEndpoint = options.dialEndpoint ?? connect
  const retryDelay = options.retryDelay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const svc = (): Promise<DeviceService> =>
    (service ??= connect().then(
      (dialed) => {
        void dialed.conn.closed.then(() => {
          service = undefined
          pool.clear()
        })
        return dialed
      },
      (error: unknown) => {
        service = undefined
        throw error
      },
    )).then((dialed) => dialed.conn)
  const pool = createAttachPool(svc, attachAddressed, options.attachIdleMs)
  const endpoints = new Map<string, string>()
  const sessionCommand: RemoteSessionsPort["sessionCommand"] = async (device, sessionId, rpc, commandOptions) => {
    // Before the command goes out nothing can have run: an attach that fails (session_not_found, as unknown_session; peer_not_found,
    // host_not_answering, a lost connection) or a record that is not JSON is refused with its code, typed.
    let held: HeldAttach
    let record: WireRpc
    try {
      record = wireRecord(rpc)
    } catch {
      return { kind: "refused", reason: "invalid_record" }
    }
    // `direct`: the device's service delivers the record to the session it lists under that key, with no attach here.
    // No connection means nothing was sent, as when the attach path cannot attach. A refusal before sending (the core
    // marks it NotSentError; a service older than #393 part B answers the `{session}` target `unsupported`) ran nothing,
    // so the record goes the attach way instead. Anything else may have run on the other device and is never resent.
    if (commandOptions?.direct === true) {
      let connected: DeviceService
      try {
        connected = await svc()
      } catch (error) {
        return { kind: "refused", reason: sessionReason(notSentReason(error)) }
      }
      // omo#14130 review round 5 (M1): the direct record shares the call's budget like every other command.
      const waitMs = commandWaitMs(SEND_WAIT_MS)
      if (waitMs <= 0) return { kind: "refused", reason: "request_timeout" }
      try {
        return outcomeOf(await connected.sessionCommand(device, sessionId, record, { waitMs }))
      } catch (error) {
        if (!(error instanceof NotSentError)) return { kind: "uncertain", reason: "reply_lost" }
      }
    }
    try {
      // omo#14130 review L1: the attach shares the call's budget; one that settles after it is released at once.
      const holding = pool.hold(device, sessionId)
      const reached = await withinCallBudget(holding)
      if (reached === undefined) {
        void holding.then(
          (late) => late.release(),
          () => undefined,
        )
        return { kind: "refused", reason: "request_timeout" }
      }
      held = reached
    } catch (error) {
      return { kind: "refused", reason: sessionReason(notSentReason(error)) }
    }
    // A record naming the session by the address the caller typed names it by the key the device attached it on: the
    // receiving endpoint refuses a record whose sessionId is not its attached session (`malformed`, relay proof 6ce7397).
    if (held.session.key !== sessionId && rpc["sessionId"] === sessionId)
      record = wireRecord({ ...rpc, sessionId: held.session.key })
    try {
      const { attached, catalog } = held.session
      const readOnly = READ_ONLY_RECORDS.has(String(rpc["type"]))
      const isHeld = HELD_RECORDS.has(String(rpc["type"]))
      const key = recordKey(record)
      if (isHeld && commandOptions?.fresh !== true) {
        const kept = catalog.get(key)
        if (kept !== undefined) return { kind: "ok", response: kept, local: true }
      }
      const sentAt = catalog.snapshots()
      // The gate is this connection's: a reconnect to an older service stops the mark.
      const carries =
        MARKED_RECORDS.has(String(rpc["type"])) && (await svc().catch(() => undefined))?.carriesWakeMark === true
      const marked = carries ? { accepts: WAKE_ACCEPTS } : undefined
      // The enclosing tool call's budget (call-deadline.ts): spent before sending, nothing is sent.
      const waitMs = commandWaitMs(readOnly ? READ_WAIT_MS : SEND_WAIT_MS)
      if (waitMs <= 0) return { kind: "refused", reason: "request_timeout" }
      try {
        const outcome = outcomeOf(await attached.command(record, { ...marked, waitMs }))
        if (isHeld && outcome.kind === "ok") catalog.keep(key, outcome.response, sentAt)
        return readOnly && outcome.kind === "uncertain" ? { kind: "refused", reason: outcome.reason } : outcome
      } catch (error) {
        // It left this device and its final state did not come back: the device has it, its answer was lost.
        if (error instanceof UnsettledCommandError && error.delivered)
          return { kind: readOnly ? "refused" : "uncertain", reason: "delivered_unconfirmed" }
        // The attach succeeded, so a failure without a local API code is a lost reply, not a failed attach.
        if (readOnly)
          return { kind: "refused", reason: error instanceof LocalApiError ? sessionReason(error.code) : "reply_lost" }
        // Only a code that answers before sending ran nothing. Anything else - a timeout after sending, the attach or
        // connection ending, a broken protocol - may have run on the other device, so it is uncertain and never retried.
        if (error instanceof LocalApiError && error.command_id === undefined && REFUSED_BEFORE_SENDING.has(error.code))
          return { kind: "refused", reason: sessionReason(error.code) }
        return { kind: "uncertain", reason: "reply_lost" }
      }
    } finally {
      held.release()
    }
  }
  const listing = async (filter?: { readonly device?: string }): Promise<RemoteListing> => {
    const listed = await (await svc()).sessions(filter?.device === undefined ? undefined : { device: filter.device })
    return {
      rows: listed.rows.map((row) => ({
        device: row.device,
        session_id: row.session_id,
        ...durableIdOf(row),
        title: row.title,
        project: row.project,
        path: row.path,
        state: row.state,
        updated_ms: row.updated_ms,
        source: row.source,
        ...(row.source === "cache" ? { as_of: row.as_of } : {}),
        ...(row.model === undefined ? {} : { model: { provider: row.model.provider, id: row.model.id } }),
        ...(row.archived === true ? { archived: true as const } : {}),
      })),
      incomplete: listed.incomplete,
    }
  }
  // Only the unfiltered account listing waits on every device, so only it is shared; a one-device listing goes out as asked.
  const round = createListingRound(() => listing(), options.now ?? Date.now)
  // thread_list asks for this device's id and name in parallel: overlapping asks share one device.info read.
  let info: ReturnType<DeviceService["thisDevice"]> | undefined
  const deviceInfo = (): ReturnType<DeviceService["thisDevice"]> => {
    if (info !== undefined) return info
    const asked = svc().then((connected) => connected.thisDevice())
    info = asked
    const clear = () => {
      if (info === asked) info = undefined
    }
    asked.then(clear, clear)
    return asked
  }
  const port = {
    status: async () => ({ state: (await (await svc()).status()).state }),
    thisDevice: async () => (await deviceInfo())?.id ?? null,
    thisDeviceName: async () => (await deviceInfo())?.name ?? null,
    devices: async () =>
      (await (await svc()).devices()).map((row) => ({
        device: row.device,
        label: row.label,
        online: row.online,
        platform: row.platform,
        kind: row.kind,
        last_seen_ms: row.last_seen_ms,
      })),
    sessions: async (filter) => (filter?.device === undefined ? await round.listing() : await listing(filter)).rows,
    listing: round.listing,
    // create / open / fork on another device: relay daemon #393's attach-less `session.command {device, endpoint, rpc}`.
    // The endpoint lookup and every refusal answered before sending ran nothing; anything after sending may have.
    // An open_session goes on the endpoint dialer (a fresh owned connection per call by default), closed once it
    // settles if owned (#12777): opening the session on the long-lived connection attaches the host's delegated engine
    // connection to it as well, so the engine writes each streamed delta twice, once to the attach stream and once
    // to the delegated connection. The attach that follows still rides the long-lived connection, which then
    // carries one copy per delta. Every other record rides the long-lived connection.
    endpointCommand: async (device, rpc, endpointOptions) => {
      let record: WireRpc
      try {
        record = wireRecord(rpc)
      } catch {
        return { kind: "refused", reason: "invalid_record" }
      }
      if (commandWaitMs(SEND_WAIT_MS) <= 0) return { kind: "refused", reason: "request_timeout" }
      let dialed: { readonly conn: DeviceService; readonly owned: boolean }
      try {
        dialed = record["type"] === "open_session" ? await dialEndpoint() : { conn: await svc(), owned: false }
      } catch (error) {
        return { kind: "refused", reason: notSentReason(error) }
      }
      const connected = dialed.conn
      // The device's engine endpoint key, kept from the last command toward it, spares each later one its session.endpoints
      // round trip. A key the device no longer lists (its host restarted) is refused before anything runs, as an
      // `unsupported` error response from this device's service or a `route_unlisted` refusal from the device's; only
      // that refusal of a KEPT key forgets it and sends the record once more on a fresh lookup. Every other outcome is
      // the answer as is: an engine that ran the record and failed it, or an uncertain one, is never sent again.
      const send = async (endpoint: string | undefined): Promise<RemoteCommandOutcome> => {
        // omo#14130 review rounds 2-3: an endpoint command (a create on another device) shares the call's budget, sized
        // after the dial; the device service takes its endpoint lookup out of it before sending.
        const waitMs = commandWaitMs(SEND_WAIT_MS)
        if (waitMs <= 0) return { kind: "refused", reason: "request_timeout" }
        let sent: EndpointCommandResult
        try {
          sent = await connected.endpointCommand(device, record, { ...endpointOptions, endpoint, waitMs })
        } catch (error) {
          if (endpoint !== undefined && unlistedEndpointError(error)) return UNLISTED_ENDPOINT
          throw error
        }
        if (sent.outcome.state === "engine_refused" && sent.outcome.reason === "route_unlisted") {
          endpoints.delete(device)
          return endpoint === undefined ? outcomeOf(sent) : UNLISTED_ENDPOINT
        }
        endpoints.set(device, sent.endpoint)
        return outcomeOf(sent)
      }
      try {
        const outcome = await send(endpoints.get(device))
        if (outcome !== UNLISTED_ENDPOINT) return outcome
        endpoints.delete(device)
        return await send(undefined)
      } catch (error) {
        // The SDK marks a failure before session.command was written (the endpoint lookup timing out or the connection
        // closing during it) not_sent: nothing ran, so it is refused. The same codes after sending stay uncertain.
        if (error instanceof NoPrimaryEndpointError) return { kind: "refused", reason: "no_primary_endpoint" }
        if (error instanceof NotSentError) return { kind: "refused", reason: error.code }
        if (error instanceof LocalApiError && error.command_id === undefined && REFUSED_BEFORE_SENDING.has(error.code))
          return { kind: "refused", reason: error.code }
        return { kind: "uncertain", reason: "reply_lost" }
      } finally {
        // Only a connection this call owns is closed here: the long-lived one and a borrowed one stay open.
        if (dialed.owned) connected.close()
      }
    },
    sessionCommand,
    read: async (device, sessionId, tail) => {
      // A read changes nothing on the other device, so every failure is a typed refusal, never uncertain.
      let page: Awaited<ReturnType<RemoteAttach["read"]>>
      let held: HeldAttach | undefined
      try {
        held = await pool.hold(device, sessionId)
        page = await held.session.attached.read({ tail })
      } catch (error) {
        return { kind: "refused", reason: sessionReason(notSentReason(error)) }
      } finally {
        held?.release()
      }
      const entries: JsonObject[] = page.entries.flatMap((item) =>
        "entry" in item && typeof item.entry === "object" && item.entry !== null && !Array.isArray(item.entry)
          ? [item.entry as JsonObject]
          : [],
      )
      return { kind: "ok", response: { entries } }
    },
    watch: async (device, sessionId, handlers, watchOptions) =>
      await openSessionWatch(
        {
          hold: pool.hold,
          getState: (onDevice, onSession) =>
            sessionCommand(onDevice, onSession, { type: "get_state", sessionId: onSession }),
          locate: async (onDevice, durableSessionId) => (await (await svc()).locate(onDevice, durableSessionId)).key,
          delay: retryDelay,
        },
        device,
        sessionId,
        handlers,
        watchOptions,
      ),
    lookup: async (device, durableId) => {
      let connected: DeviceService
      try {
        connected = await svc()
      } catch (error) {
        return { kind: "silent", reason: notSentReason(error) }
      }
      if (!connected.takesSingleLocate) return { kind: "unavailable" }
      let timer: ReturnType<typeof setTimeout> | undefined
      const capped = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), options.lookupCapMs ?? LOOKUP_CAP_MS)
        timer.unref?.()
      })
      try {
        const answer = await Promise.race([connected.locate(device, durableId, { single: true }), capped])
        if (answer === "timeout") return { kind: "silent", reason: "lookup_timeout" }
        return { kind: "found", key: answer.key }
      } catch (error) {
        const code = error instanceof LocalApiError ? error.code : "locate_failed"
        return LOOKUP_NONE.has(code) ? { kind: "none" } : { kind: "silent", reason: code }
      } finally {
        clearTimeout(timer)
      }
    },
    canWake: async () => (await svc().catch(() => undefined))?.carriesWakeMark === true,
    canLookup: async () => (await svc().catch(() => undefined))?.takesSingleLocate === true,
    wake: async (device, durableId, rpc) => {
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
      if (!connected.carriesWakeMark) return { kind: "unavailable" }
      // omo#14130 review M1: a wake shares the call's budget like every other command.
      const waitMs = commandWaitMs(SEND_WAIT_MS)
      if (waitMs <= 0) return { kind: "refused", reason: "request_timeout" }
      try {
        return outcomeOf(await connected.wakeCommand(device, durableId, record, { waitMs }))
      } catch (error) {
        if (error instanceof NotSentError) return { kind: "refused", reason: error.code }
        if (error instanceof LocalApiError && error.command_id === undefined && REFUSED_BEFORE_SENDING.has(error.code))
          return { kind: "refused", reason: error.code }
        return { kind: "uncertain", reason: "reply_lost" }
      }
    },
    close: async () => {
      // Closing the connection ends every listing it answered: no read after this joins a round still running on it or
      // reuses what it kept (the caller may close to force a fresh listing).
      round.invalidate()
      const open = service
      service = undefined
      pool.clear()
      // Only a connection this port owns is closed here: a borrowed one (the CLI's) stays open for its owner.
      if (open !== undefined) {
        const dialed = await open.catch(() => undefined)
        if (dialed !== undefined && dialed.owned) dialed.conn.close()
      }
    },
    locate: async (device, engineId, knownKey) => {
      let connected: DeviceService
      try {
        connected = await svc()
      } catch (error) {
        return { kind: "refused", reason: notSentReason(error) }
      }
      // A create reply that already names the session's listing key needs no session.locate round trip, and no attach
      // either: a located session is attachable at once (CommandResult.located), so the next command attaches it itself.
      if (knownKey !== undefined) return { kind: "ok", sessionId: knownKey }
      let key: string
      try {
        // omo#14130 review round 3 (L1): an older service's post-create locate shares the call's budget.
        const located = await withinCallBudget(connected.locate(device, engineId))
        if (located === undefined) return { kind: "refused", reason: "request_timeout" }
        key = located.key
      } catch (error) {
        return { kind: "refused", reason: error instanceof LocalApiError ? error.code : "locate_failed" }
      }
      // The session exists under `key` from here on; wait (bounded) until the listing names it so the next command's
      // attach finds it, and keep that attach for it.
      // omo#14130 review round 2 (L3): inside a tool call the wait for the listing ends with the call's budget.
      const deadline = Date.now() + Math.max(0, commandWaitMs(CREATED_ATTACH_WAIT_MS))
      for (let wait = 250; ; wait = Math.min(wait * 2, 2_000)) {
        try {
          const holding = pool.hold(device, key)
          const held = await withinCallBudget(holding)
          if (held === undefined) {
            void holding.then(
              (late) => late.release(),
              () => undefined,
            )
            break
          }
          held.release()
          break
        } catch (error) {
          if (!(error instanceof LocalApiError && error.code === "session_not_found") || Date.now() + wait > deadline)
            break
          await retryDelay(wait)
        }
      }
      return { kind: "ok", sessionId: key }
    },
  } satisfies RemoteSessionsPort
  // A create, open, fork, wake, locate or session command that is not a read changes what devices list.
  return {
    ...port,
    endpointCommand: round.fenced(port.endpointCommand),
    locate: round.fenced(port.locate),
    wake: round.fenced(port.wake),
    sessionCommand: (device, sessionId, rpc, commandOptions) =>
      READ_ONLY_RECORDS.has(String(rpc["type"]))
        ? sessionCommand(device, sessionId, rpc, commandOptions)
        : round.fenced(sessionCommand)(device, sessionId, rpc, commandOptions),
  }
}
