import { execFile } from "node:child_process"
import { createConnection, type Socket } from "node:net"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { resolveTaskHostSocket, TASK_HOST_SOCKET_ENV_NAMES } from "../../../../senpi-task/src/runners/rpc-host/daemon"
import { resolveProjectStateDirectory } from "../../../../senpi-task/src/store/project-state-directory"
import type { SenpiExtensionAPI } from "../../extension/types"
import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { resolveSenpiLaunch, withoutForeignPackageDirEnv } from "../memory/worker/senpi-command"
import { readDiskSession, type AddressBookHost, type DiskSession } from "./address-book"
import type { ThreadTranscriptEntry, ThreadHost, ThreadHostSession } from "./tools"
import type { ThreadHostView, ThreadSessionPort } from "./tools/ports"

type RpcFrame = { readonly success?: boolean; readonly data?: unknown; readonly error?: unknown }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function dataRecord(frame: RpcFrame, command: unknown): Record<string, unknown> {
  if (frame.success === false && command === "set_thinking_level" && typeof frame.error === "string" && /^Thinking level .+ is not supported by the active model\.$/.test(frame.error)) {
    throw new Error(`thinking_level_unsupported:${frame.error}`)
  }
  if (frame.success && frame.data === undefined && (command === "set_session_name" || command === "set_thinking_level")) return {}
  if (!frame.success || !record(frame.data)) throw new Error(`thread RPC request failed: ${JSON.stringify(frame.error ?? frame)}`)
  return frame.data
}
/** Opens the one-shot connection a request runs on; a test seam that observes which endpoint is dialed. */
export type ThreadSocketConnect = (socketPath: string) => Socket

const REQUEST_TIMEOUT_MS = 60_000
/** Budget for one endpoint's `list_sessions` while enumerating: one hung shard must not stall every call. */
export const ENDPOINT_LIST_TIMEOUT_MS = 10_000
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
 * One request, one correlated response. The multi-session host writes other lines on the same
 * connection before the reply: the `open_session` admission notice (`{type:"queued",
 * for_request:<our id>}`, deliberately NOT carrying the response id so a client that settles by
 * id never takes it for the reply) and connection-wide broadcasts (`agent_start`,
 * `session_opened`, ...). Only the frame whose `id` equals the request id settles the call;
 * every other line is skipped.
 */
async function request(socketPath: string, command: Record<string, unknown>, connect: ThreadSocketConnect, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Record<string, unknown>> {
  const id = randomUUID()
  return await new Promise((resolve, reject) => {
    const socket = connect(socketPath)
    let buffer = ""
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("thread RPC request timed out")) }, timeoutMs)
    const finish = (error?: Error, value?: Record<string, unknown>) => { clearTimeout(timer); socket.destroy(); error === undefined ? resolve(value as Record<string, unknown>) : reject(error) }
    socket.once("error", (error) => finish(error))
    socket.once("close", () => finish(new Error(`thread RPC connection closed before the ${String(command.type)} response arrived`)))
    socket.once("connect", () => socket.write(`${JSON.stringify({ id, ...command })}\n`))
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
        try { finish(undefined, dataRecord(frame as RpcFrame, command.type)) } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
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
 * reduced to what addressing reads: where the endpoint listens, whether it answered, and the session
 * files it names (listed rows, and path claims its `reservations/` still hold after it died).
 */
export type HostEndpointReport = {
  readonly socket: string | null
  readonly reachable: boolean
  readonly session_paths: readonly string[]
}

/** `undefined` means the engine cannot enumerate (a pre-release engine's usage error, no CLI): the legacy endpoint alone. */
export type HostStatusAllRunner = () => Promise<readonly HostEndpointReport[] | undefined>

function stringsAt(rows: unknown, field: string): string[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => (record(row) && typeof row[field] === "string" && row[field] !== "" ? [row[field] as string] : []))
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
        session_paths: [...new Set([...stringsAt(endpoint.session_rows, "session_path"), ...stringsAt(endpoint.claims, "session_path")])],
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
  readonly connect?: ThreadSocketConnect
  readonly now?: () => number
}

type EndpointListing = { readonly host: AddressBookHost; readonly sessions: readonly ThreadHostSession[]; readonly disk: readonly DiskSession[]; readonly failure?: unknown }

/**
 * The thread tools' client for every host endpoint this agent dir holds: the legacy socket
 * (`resolveThreadSocket`, where `omo daemon attach` sessions live) plus every endpoint the engine
 * enumerates (per-thread `i-*` and per-parent `p-*` shards). It never starts or replaces a host.
 * Each call lists every endpoint live; a session is reached on the endpoint that listed it, because
 * routing ids are per-host counters. `thread_create` opens on the legacy endpoint.
 */
export function createLiveThreadSurface(_pi: SenpiExtensionAPI, options: LiveThreadSurfaceOptions = {}): ThreadHost {
  const env = options.env ?? process.env
  const exists = options.exists ?? existsSync
  const connect = options.connect ?? ((path: string) => createConnection(path))
  const now = options.now ?? Date.now
  const statusAll = options.statusAll ?? engineHostStatusAll(env)
  const legacy = resolveThreadSocket(options.env)
  let enumeration: { readonly expiresAt: number; readonly reports: Promise<readonly HostEndpointReport[] | undefined> } | undefined
  // Session files each endpoint listed on its last answer: a host that stopped cleanly released its
  // claims, and this is then the only record of which threads it held.
  const lastListed = new Map<string, readonly string[]>()

  const callOn = async <T>(socket: string, type: string, data: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> => {
    if (!exists(socket)) throw new Error(`host_unavailable:${socket}`)
    return await request(socket, { type, ...data }, connect, timeoutMs) as T
  }
  const call = <T>(type: string, data: Record<string, unknown> = {}): Promise<T> => callOn<T>(legacy, type, data)

  const endpoints = async (): Promise<ReadonlyMap<string, { readonly socket: string; readonly paths: readonly string[] }>> => {
    if (enumeration === undefined || enumeration.expiresAt <= now()) {
      enumeration = { expiresAt: now() + HOST_ENDPOINTS_CACHE_TTL_MS, reports: statusAll().catch(() => undefined) }
    }
    const found = new Map<string, { readonly socket: string; readonly paths: readonly string[] }>([[resolve(legacy), { socket: legacy, paths: [] }]])
    for (const report of (await enumeration.reports) ?? []) {
      if (report.socket === null) continue
      const key = resolve(report.socket)
      found.set(key, { socket: found.get(key)?.socket ?? report.socket, paths: report.session_paths })
    }
    return found
  }

  const listEndpoint = async (socket: string, claimed: readonly string[]): Promise<EndpointListing> => {
    try {
      const { sessions } = await callOn<{ sessions: ThreadHostSession[] }>(socket, "list_sessions", OBSERVE, ENDPOINT_LIST_TIMEOUT_MS)
      const tagged = sessions.map((session) => ({ ...session, socket }))
      lastListed.set(socket, tagged.flatMap((session) => (session.sessionPath === undefined ? [] : [session.sessionPath])))
      return { host: { socket, list_sessions: { sessions: tagged } }, sessions: tagged, disk: [] }
    } catch (error) {
      const known = new Set([...claimed, ...(lastListed.get(socket) ?? [])])
      const disk = [...known].flatMap((path) => { const session = readDiskSession(path, socket); return session === null ? [] : [session] })
      return { host: { socket, error: error instanceof Error ? error.message : String(error) }, sessions: [], disk, failure: error }
    }
  }

  const listView = async (): Promise<ThreadHostView> => {
    const found = await endpoints()
    const listed = await Promise.all([...found.values()].map(({ socket, paths }) => listEndpoint(socket, paths)))
    for (const socket of [...lastListed.keys()]) if (![...found.values()].some((endpoint) => endpoint.socket === socket)) lastListed.delete(socket)
    // Nothing answered: the same failure a single-endpoint client has always raised, legacy first.
    if (listed.every((endpoint) => endpoint.failure !== undefined)) throw listed[0]?.failure
    return { sessions: listed.flatMap((endpoint) => endpoint.sessions), hosts: listed.map((endpoint) => endpoint.host), disk: listed.flatMap((endpoint) => endpoint.disk) }
  }

  const sessionMethods = (send: <T>(type: string, data?: Record<string, unknown>) => Promise<T>): ThreadSessionPort => ({
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
  })

  return {
    socket: legacy,
    listSessions: async () => (await listView()).sessions,
    listView,
    endpoint: (socket) => sessionMethods((type, data) => callOn(socket, type, data)),
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
      return { ...result.state, ...(listed ?? {}), sessionId: routingId, socket: legacy }
    },
    ...sessionMethods(call),
  }
}

export function defaultThreadStateDirectory(pi: SenpiExtensionAPI): string { return resolveProjectStateDirectory(pi.cwd ?? process.cwd(), "thread-tools") }
