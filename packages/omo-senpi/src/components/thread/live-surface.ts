import { execFile } from "node:child_process"
import { createConnection, type Socket } from "node:net"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { resolveTaskHostSocket, TASK_HOST_SOCKET_ENV_NAMES } from "../../../../senpi-task/src/runners/rpc-host/daemon"
import { resolveProjectStateDirectory } from "../../../../senpi-task/src/store/project-state-directory"
import type { SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { resolveSenpiLaunch, withoutForeignPackageDirEnv } from "../memory/worker/senpi-command"
import { readDiskSession, type AddressBookHost, type DiskSession } from "./address-book"
import { controlSocketSecretPath, endpointKindOf, isTuiControlSocket, listRegistryEndpoints, type EndpointKind, type RegistryEndpoint } from "./endpoint-registry"
import type { EndpointLiveness, GatewayEndpointPort, GatewayEndpointRef, ReleaseSessionReply } from "./gateway/adapter"
import type { ThreadTranscriptEntry, ThreadHost, ThreadHostSession } from "./tools"
import type { ThreadHostView, ThreadSessionPort } from "./tools/ports"

type RpcFrame = { readonly success?: boolean; readonly data?: unknown; readonly error?: unknown; readonly errorData?: unknown }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function dataRecord(frame: RpcFrame, command: unknown): Record<string, unknown> {
  if (frame.success === false && command === "set_thinking_level" && typeof frame.error === "string" && /^Thinking level .+ is not supported by the active model\.$/.test(frame.error)) {
    throw new Error(`thinking_level_unsupported:${frame.error}`)
  }
  if (frame.success === false && frame.error === "unsupported") throw new Error(`unsupported:${String(command)}`)
  if (frame.success && frame.data === undefined && (command === "set_session_name" || command === "set_thinking_level")) return {}
  if (!frame.success || !record(frame.data)) throw new Error(`thread RPC request failed: ${JSON.stringify(frame.error ?? frame)}`)
  return frame.data
}
/** Opens the one-shot connection a request runs on; a test seam that observes which endpoint is dialed. */
export type ThreadSocketConnect = (socketPath: string) => Socket

const REQUEST_TIMEOUT_MS = 60_000
/** Budget for one endpoint's `list_sessions` while enumerating: one hung shard must not stall every call. */
export const ENDPOINT_LIST_TIMEOUT_MS = 10_000
/**
 * A terminal answers from the user's own process: a suspended (`^Z`) or busy one costs a listing at
 * most this long, the same bound senpi's `status --all` probes a `tui` row under (TUI_PROBE_TIMEOUT_MS).
 */
export const TUI_REQUEST_TIMEOUT_MS = 1_500
/** How long one `host status --all` enumeration is reused before the engine is asked again. */
export const HOST_ENDPOINTS_CACHE_TTL_MS = 5_000
const HOST_STATUS_ALL_TIMEOUT_MS = 30_000
export const HOST_STATUS_ALL_ARGS = ["host", "status", "--all", "--include-workers", "--json"] as const
/**
 * Marks a read-only listing as an observation (senpi `OBSERVE_REQUEST_FIELD`): without it the supervisor
 * counts the connection as an attachment, so every thread tool call would reset each shard's idle window
 * and no shard would ever idle out. Never sent on a request that acts on a session.
 */
const OBSERVE = { observe: true } as const

/**
 * The whole command surface of a terminal control endpoint (senpi `session-control-commands.ts`).
 * Nothing that starts, steers or queues a turn is sent to a terminal: messages reach it only through
 * the gateway, whose inbox the terminal's own extension drains. Any other command is refused here as
 * `unsupported` before a connection is opened.
 */
export const TUI_ENDPOINT_COMMANDS: ReadonlySet<string> = new Set([
  "get_protocol_info",
  "list_sessions",
  "get_state",
  "get_messages",
  "set_session_name",
  "wake",
  "subscribe",
  "extension_ui_response",
])

type RequestOptions = { readonly timeoutMs?: number; readonly secret?: Uint8Array }

/**
 * One request, one correlated response. The multi-session host writes other lines on the same
 * connection before the reply: the `open_session` admission notice (`{type:"queued",
 * for_request:<our id>}`, deliberately NOT carrying the response id so a client that settles by
 * id never takes it for the reply) and connection-wide broadcasts (`agent_start`,
 * `session_opened`, ...). Only the frame whose `id` equals the request id settles the call;
 * every other line is skipped. A terminal control endpoint authenticates the connection with its
 * 32-byte secret, which is written before the request.
 */
async function requestFrame(socketPath: string, command: Record<string, unknown>, connect: ThreadSocketConnect, options: RequestOptions = {}): Promise<RpcFrame> {
  const id = randomUUID()
  return await new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    let buffer = ""
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("thread RPC request timed out")) }, options.timeoutMs ?? REQUEST_TIMEOUT_MS)
    const finish = (error?: Error, value?: RpcFrame) => { clearTimeout(timer); socket.destroy(); error === undefined ? resolve(value as RpcFrame) : reject(error) }
    socket.once("error", (error) => finish(error))
    socket.once("close", () => finish(new Error(`thread RPC connection closed before the ${String(command.type)} response arrived`)))
    socket.once("connect", () => {
      if (options.secret !== undefined) socket.write(Buffer.from(options.secret))
      socket.write(`${JSON.stringify({ id, ...command })}\n`)
    })
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8")
      let newline = buffer.indexOf("\n")
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf("\n")
        if (line.trim() === "") continue
        let frame: unknown
        try { frame = JSON.parse(line) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); return }
        if (!record(frame) || frame.id !== id) continue
        finish(undefined, frame as RpcFrame)
        return
      }
    })
  })
}

/**
 * Socket overrides, most specific first: the engine's own brand-prefixed `RPC_SOCKET` names
 * (`envValue("RPC_SOCKET")` in senpi), then `OMO_RPC_SOCKET_PATH`, which the desktop sets on the
 * host it spawns so that host binds beside the CLI host instead of replacing it. The list and the
 * precedence live ONCE, beside the task daemon that attaches to the same socket.
 */
export const THREAD_SOCKET_ENV_NAMES = TASK_HOST_SOCKET_ENV_NAMES

/** Client for Senpi's existing supervisor-owned unix socket. It never starts or replaces a host. */
export function resolveThreadSocket(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return resolveTaskHostSocket(env, resolveAgentHome({ env }))
}

/**
 * One endpoint row of `senpi host status --all --include-workers --json` (`{ endpoints: [...] }`),
 * reduced to what addressing reads: where the endpoint listens, whether it answered, the session
 * files it names (listed rows, path claims its `reservations/` still hold after it died, and a
 * terminal's `owner.session.path`), and - from engines that report them - its `endpoint_kind` and
 * liveness verdict (`alive`, and `reason` when not alive).
 */
export type HostEndpointReport = {
  readonly socket: string | null
  readonly reachable: boolean
  readonly session_paths: readonly string[]
  readonly endpoint_kind?: EndpointKind
  readonly alive?: boolean
  readonly reason?: "live_unresponsive" | "dead" | null
}

/** `undefined` means the engine cannot enumerate (a pre-release engine's usage error, no CLI): the registry on disk is read instead. */
export type HostStatusAllRunner = () => Promise<readonly HostEndpointReport[] | undefined>

function stringsAt(rows: unknown, field: string): string[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => (record(row) && typeof row[field] === "string" && row[field] !== "" ? [row[field] as string] : []))
}

function ownerSessionPath(owner: unknown): string[] {
  if (!record(owner) || !record(owner.session)) return []
  const path = owner.session.path
  return typeof path === "string" && path !== "" ? [path] : []
}

/** Reads the one JSON line `host status --all` prints; anything without an `endpoints` array cannot enumerate. */
export function parseHostStatusAll(stdout: string | undefined): readonly HostEndpointReport[] | undefined {
  const line = stdout?.trim().split("\n").filter((candidate) => candidate.trim() !== "").pop()
  if (line === undefined) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(line) } catch { return undefined }
  if (!record(parsed) || !Array.isArray(parsed.endpoints)) return undefined
  return parsed.endpoints.flatMap((endpoint: unknown) => record(endpoint)
    ? [{
        socket: typeof endpoint.socket === "string" && endpoint.socket !== "" ? endpoint.socket : null,
        reachable: endpoint.reachable === true,
        session_paths: [...new Set([...stringsAt(endpoint.session_rows, "session_path"), ...stringsAt(endpoint.claims, "session_path"), ...ownerSessionPath(endpoint.owner)])],
        ...(endpoint.endpoint_kind === "tui" || endpoint.endpoint_kind === "rpc_host" ? { endpoint_kind: endpoint.endpoint_kind } : {}),
        ...(typeof endpoint.alive === "boolean" ? { alive: endpoint.alive } : {}),
        ...(endpoint.reason === "live_unresponsive" || endpoint.reason === "dead" ? { reason: endpoint.reason } : endpoint.reason === null ? { reason: null } : {}),
      }]
    : [])
}

/**
 * Asks the engine CLI that runs this session. The exit code is not the verdict: `status --all` exits
 * 3 when no endpoint answers and still prints its line, while a pre-release engine rejects `--all`
 * as a usage error with no line at all - both are read from stdout alone.
 */
function engineHostStatusAll(env: Readonly<Record<string, string | undefined>>): HostStatusAllRunner {
  return async () => {
    let launch: ReturnType<typeof resolveSenpiLaunch>
    try { launch = resolveSenpiLaunch({ ...env }) } catch { return undefined }
    const stdout = await new Promise<string | undefined>((done) => {
      execFile(
        launch.command,
        [...launch.prefixArgs, ...HOST_STATUS_ALL_ARGS],
        { env: withoutForeignPackageDirEnv({ ...env }, launch), timeout: HOST_STATUS_ALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        (_error, out) => done(typeof out === "string" ? out : undefined),
      )
    })
    return parseHostStatusAll(stdout)
  }
}

export type LiveThreadSurfaceOptions = {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly exists?: (path: string) => boolean
  /** Replaces the engine CLI enumeration; tests answer it without spawning anything. */
  readonly statusAll?: HostStatusAllRunner
  readonly registry?: () => Promise<readonly RegistryEndpoint[]>
  readonly readSecret?: (socket: string) => Uint8Array
  readonly connect?: ThreadSocketConnect
  readonly now?: () => number
}

type EndpointVerdict = { readonly alive?: boolean; readonly reason?: "live_unresponsive" | "dead" | null }
type KnownEndpoint = { readonly socket: string; readonly paths: readonly string[]; readonly kind: EndpointKind; readonly verdict: EndpointVerdict }
type EndpointListing = { readonly host: AddressBookHost; readonly sessions: readonly ThreadHostSession[]; readonly disk: readonly DiskSession[]; readonly failure?: unknown }

export type LiveThreadSurface = ThreadHost & { readonly gateway: GatewayEndpointPort }

function isConnectRefusal(error: unknown): boolean {
  const code = record(error) ? error.code : undefined
  return code === "ENOENT" || code === "ECONNREFUSED"
}

function releaseReply(frame: RpcFrame): ReleaseSessionReply {
  if (frame.success === true && record(frame.data) && frame.data.released === true) return frame.data as ReleaseSessionReply
  const data = record(frame.errorData) ? frame.errorData : {}
  const dropped = record(data.dropped) ? (data.dropped as { deliveries: string[]; user_messages: string[] }) : undefined
  const busy = Array.isArray(data.busy) ? data.busy.filter((entry): entry is string => typeof entry === "string") : undefined
  return { released: false, error: typeof frame.error === "string" ? frame.error : "release_failed", ...(busy === undefined ? {} : { busy }), ...(dropped === undefined ? {} : { dropped }) }
}

/**
 * The thread tools' client for every endpoint this agent dir holds: the legacy socket
 * (`resolveThreadSocket`, where `omo daemon attach` sessions live), every host shard (`i-*`, `p-*`)
 * and every terminal control endpoint (`tui`) the engine enumerates - or, when the engine cannot
 * enumerate, the registry on disk names. It never starts or replaces a host. Each call lists every
 * endpoint live; a session is reached on the endpoint that listed it, because routing ids are
 * per-host counters. `thread_create` opens on the legacy endpoint. A terminal is only ever sent the
 * commands in TUI_ENDPOINT_COMMANDS, with its secret first.
 */
export function createLiveThreadSurface(_pi: SenpiExtensionAPI, options: LiveThreadSurfaceOptions = {}): LiveThreadSurface {
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync
  const connect = options.connect ?? ((path: string) => createConnection(path))
  const now = options.now ?? Date.now
  const statusAll = options.statusAll ?? engineHostStatusAll(env)
  const registry = options.registry ?? (() => listRegistryEndpoints(resolveAgentHome({ env })))
  const readSecret = options.readSecret ?? ((socket: string) => readFileSync(controlSocketSecretPath(socket)))
  const legacy = resolveThreadSocket(options.env)
  let enumeration: { readonly expiresAt: number; readonly endpoints: Promise<readonly KnownEndpoint[]> } | undefined
  // Session files each endpoint listed on its last answer: a host that stopped cleanly released its
  // claims, and this is then the only record of which threads it held.
  const lastListed = new Map<string, readonly string[]>()
  // What serves each socket, as the last enumeration said; a socket's name decides before that.
  const kinds = new Map<string, EndpointKind>()

  const kindOf = (socket: string): EndpointKind => kinds.get(resolve(socket)) ?? (isTuiControlSocket(socket) ? "tui" : "rpc_host")

  const callFrame = async (socket: string, type: string, data: Record<string, unknown> = {}, timeoutMs?: number): Promise<RpcFrame> => {
    const tui = kindOf(socket) === "tui"
    if (tui && !TUI_ENDPOINT_COMMANDS.has(type)) throw new Error(`unsupported:${type}`)
    if (!exists(socket)) throw new Error(`host_unavailable:${socket}`)
    let secret: Uint8Array | undefined
    if (tui) {
      try { secret = readSecret(socket) } catch { throw new Error(`host_unavailable:${socket}`) }
    }
    return await requestFrame(socket, { type, ...data }, connect, { timeoutMs: timeoutMs ?? (tui ? TUI_REQUEST_TIMEOUT_MS : undefined), secret })
  }
  const callOn = async <T>(socket: string, type: string, data: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> =>
    dataRecord(await callFrame(socket, type, data, timeoutMs), type) as T
  const call = <T>(type: string, data: Record<string, unknown> = {}): Promise<T> => callOn<T>(legacy, type, data)

  const enumerate = async (): Promise<readonly KnownEndpoint[]> => {
    const [reports, recorded] = await Promise.all([statusAll().catch(() => undefined), registry().catch(() => [] as readonly RegistryEndpoint[])])
    const found = reports === undefined
      ? recorded.flatMap((entry) => (entry.socket === null ? [] : [{ socket: entry.socket, paths: [] as readonly string[], kind: entry.endpoint_kind, verdict: {} }]))
      : reports.flatMap((report) => report.socket === null
          ? []
          : [{
              socket: report.socket,
              paths: report.session_paths,
              kind: report.endpoint_kind ?? endpointKindOf(report.socket, recorded),
              verdict: { ...(report.alive === undefined ? {} : { alive: report.alive }), ...(report.reason === undefined ? {} : { reason: report.reason }) },
            }])
    const legacyKind = endpointKindOf(legacy, recorded)
    return [{ socket: legacy, paths: [], kind: legacyKind, verdict: {} }, ...found.filter((endpoint) => resolve(endpoint.socket) !== resolve(legacy))]
  }

  const endpoints = async (): Promise<readonly KnownEndpoint[]> => {
    if (enumeration === undefined || enumeration.expiresAt <= now()) {
      enumeration = { expiresAt: now() + HOST_ENDPOINTS_CACHE_TTL_MS, endpoints: enumerate() }
    }
    const known = await enumeration.endpoints
    for (const endpoint of known) kinds.set(resolve(endpoint.socket), endpoint.kind)
    return known
  }

  const degraded = (endpoint: KnownEndpoint, error: unknown, reason: "live_unresponsive" | "dead" | null): EndpointListing => {
    const known = new Set([...endpoint.paths, ...(lastListed.get(endpoint.socket) ?? [])])
    const disk = [...known].flatMap((path) => { const session = readDiskSession(path, endpoint.socket); return session === null ? [] : [session] })
    return {
      host: { socket: endpoint.socket, error: error instanceof Error ? error.message : String(error), endpoint_kind: endpoint.kind, alive: false, reason, legacy: endpoint.socket === legacy },
      sessions: [],
      disk,
      failure: error,
    }
  }

  const listEndpoint = async (endpoint: KnownEndpoint): Promise<EndpointListing> => {
    const tui = endpoint.kind === "tui"
    // The engine already probed a terminal under its 1.5 s budget and found it not answering: a
    // suspended or remote terminal is reported, never dialed again, reaped or reopened elsewhere.
    if (tui && endpoint.verdict.alive === false) return degraded(endpoint, new Error(endpoint.verdict.reason ?? "live_unresponsive"), endpoint.verdict.reason ?? "live_unresponsive")
    try {
      const { sessions } = await callOn<{ sessions: ThreadHostSession[] }>(endpoint.socket, "list_sessions", tui ? {} : OBSERVE, tui ? TUI_REQUEST_TIMEOUT_MS : ENDPOINT_LIST_TIMEOUT_MS)
      const tagged = sessions.map((session) => ({
        ...session,
        socket: endpoint.socket,
        endpoint_kind: endpoint.kind,
        ...(tui && session.durableSessionId === undefined ? { durableSessionId: session.sessionId } : {}),
      }))
      lastListed.set(endpoint.socket, tagged.flatMap((session) => (typeof session.sessionPath === "string" ? [session.sessionPath] : [])))
      return { host: { socket: endpoint.socket, list_sessions: { sessions: tagged }, endpoint_kind: endpoint.kind, alive: true, reason: null, legacy: endpoint.socket === legacy }, sessions: tagged, disk: [] }
    } catch (error) {
      const timedOut = error instanceof Error && error.message === "thread RPC request timed out"
      return degraded(endpoint, error, endpoint.verdict.reason ?? (timedOut ? "live_unresponsive" : isConnectRefusal(error) ? "dead" : null))
    }
  }

  const listView = async (): Promise<ThreadHostView> => {
    const found = await endpoints()
    const listed = await Promise.all(found.map((endpoint) => listEndpoint(endpoint)))
    for (const socket of [...lastListed.keys()]) if (!found.some((endpoint) => endpoint.socket === socket)) lastListed.delete(socket)
    // Nothing answered: the same failure a single-endpoint client has always raised, legacy first.
    if (listed.every((endpoint) => endpoint.failure !== undefined)) throw listed[0]?.failure
    return { sessions: listed.flatMap((endpoint) => endpoint.sessions), hosts: listed.map((endpoint) => endpoint.host), disk: listed.flatMap((endpoint) => endpoint.disk) }
  }

  const sessionMethods = (socket: string | undefined, send: <T>(type: string, data?: Record<string, unknown>) => Promise<T>): ThreadSessionPort => ({
    getMessages: async (sessionId) => (await send<{ messages: ThreadTranscriptEntry[] }>("get_messages", { sessionId })).messages,
    getState: (sessionId) => send("get_state", { sessionId }),
    prompt: (sessionId, message, options) => send("prompt", { sessionId, message, ...options }),
    interrupt: (sessionId, turnId) => send("interrupt", { sessionId, ...(turnId === undefined ? {} : { turnId }) }),
    setSessionName: async (sessionId, name) => { await send("set_session_name", { sessionId, name }) },
    setModel: (sessionId, provider, modelId) => send("set_model", { sessionId, provider, modelId }),
    getAvailableModels: async (sessionId) => {
      const { models } = await send<{ models: Awaited<ReturnType<ThreadHost["getAvailableModels"]>> }>("get_available_models", { sessionId })
      return models.map(({ provider, id, name }) => ({ provider, id, ...(name === undefined ? {} : { name }) }))
    },
    setThinkingLevel: async (sessionId, level, scope) => { await send("set_thinking_level", { sessionId, level, ...(scope === "turn" ? { scope } : {}) }) },
    getAvailableThinkingLevels: async (sessionId) => (await send<{ levels: string[] }>("get_available_thinking_levels", { sessionId })).levels,
    wake: async (sessionId, deliveryIds) => {
      const { admitted } = await send<{ admitted?: { delivery_id: string; kind: string }[] }>("wake", { sessionId, delivery_ids: [...deliveryIds] })
      return { admitted: Array.isArray(admitted) ? admitted : [] }
    },
    releaseSession: async (sessionId, release) => {
      const target = socket ?? legacy
      return releaseReply(await callFrame(target, "release_session", { sessionId, reason: "takeover", ...release }))
    },
  })

  const liveness = async (endpoint: GatewayEndpointRef): Promise<EndpointLiveness> => {
    const known = (await endpoints()).find((candidate) => resolve(candidate.socket) === resolve(endpoint.socket))
    if (known?.verdict.alive === true) return "routable"
    if (known?.verdict.reason === "live_unresponsive" || known?.verdict.reason === "dead") return known.verdict.reason
    try {
      await callOn(endpoint.socket, "get_protocol_info", {}, endpoint.kind === "tui" ? TUI_REQUEST_TIMEOUT_MS : ENDPOINT_LIST_TIMEOUT_MS)
      return "routable"
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("host_unavailable:")) return "dead"
      return isConnectRefusal(error) ? "dead" : "live_unresponsive"
    }
  }

  /**
   * The gateway's sender port. A delivery is announced with `wake` only - never `prompt`: on a host
   * the session is named by its routing id, a terminal holds exactly one session. `release_session`
   * exists on hosts only.
   */
  const gateway: GatewayEndpointPort = {
    wake: async (endpoint, deliveryIds) => {
      kinds.set(resolve(endpoint.socket), endpoint.kind)
      const target = endpoint.kind === "rpc_host" && endpoint.routing_id !== null ? { sessionId: endpoint.routing_id } : {}
      const { admitted } = await callOn<{ admitted?: { delivery_id: string; kind: string }[] }>(endpoint.socket, "wake", { ...target, delivery_ids: [...deliveryIds] })
      return { admitted: Array.isArray(admitted) ? admitted : [] }
    },
    releaseSession: async (endpoint, release) => {
      if (endpoint.kind !== "rpc_host" || endpoint.routing_id === null) throw new Error("unsupported:release_session")
      return releaseReply(await callFrame(endpoint.socket, "release_session", { sessionId: endpoint.routing_id, reason: "takeover", ...release }))
    },
    classifyLiveness: liveness,
  }

  return {
    socket: legacy,
    listSessions: async () => (await listView()).sessions,
    listView,
    endpoint: (socket) => sessionMethods(socket, (type, data) => callOn(socket, type, data)),
    gateway,
    /**
     * `open_session` answers with the ROUTING id and a state that carries neither the durable id
     * nor a name, but the address book keys every entry by the durable id - so returning the wire
     * reply as-is hands the caller an address that resolves to not_found on its very next call.
     * The wire also has no name field on open, while the family's contract says a created thread
     * can be named. Both are settled here, in the adapter that owns the wire: apply the name when
     * one was asked for, then read the session list back and merge the entry the host now reports.
     * A created thread lives on the legacy endpoint, so its reply names that socket.
     */
    openSession: async (params) => {
      // `retain_on_disconnect` (host capability of the same name, wire default false) makes the
      // host DETACH instead of closing when a connection drops. This client is one-shot - the
      // connection that opens the session ends immediately - so without the flag the new session
      // goes straight to `closing` and every later call answers `session_closing`.
      const result = await call<{ sessionId: string; state: ThreadHostSession }>("open_session", { ...(params as Record<string, unknown>), retain_on_disconnect: true })
      const routingId = result.sessionId
      const name = (params as { readonly name?: string }).name
      if (name !== undefined && name.trim() !== "") await call("set_session_name", { sessionId: routingId, name })
      const { sessions } = await call<{ sessions: readonly ThreadHostSession[] }>("list_sessions", OBSERVE)
      const listed = sessions.find((session) => session.sessionId === routingId)
      return { ...result.state, ...(listed ?? {}), sessionId: routingId, socket: legacy, endpoint_kind: "rpc_host" }
    },
    ...sessionMethods(undefined, call),
  }
}

export function defaultThreadStateDirectory(pi: SenpiExtensionAPI): string { return resolveProjectStateDirectory(pi.cwd ?? process.cwd(), "thread-tools") }
