import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import { normalizeThreadName, type ThreadAddressEntry } from "./addressing"
import type { ThreadStatus } from "./contracts"
import type { EndpointKind } from "./endpoint-registry"
import type { GatewayAddressEntry } from "./gateway/engine"
import { parseSessionLines, readSessionFacts, summarizeSessionEntries, threadTitle, type SessionFacts } from "./session-facts"

export type HostSessionStatus = "opening" | "open" | "closing" | "closed"

export type HostSession = {
  readonly sessionId: string
  readonly durableSessionId?: string
  readonly sessionPath?: string
  readonly cwd: string
  readonly name?: string | null
  /** Absent on hosts that predate the field; anything but `closed` is live. */
  readonly status?: HostSessionStatus
  /** The host's session kind (`interactive` | `worker`); a terminal endpoint lists its one session as `interactive`. */
  readonly kind?: string
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly created_at?: string | null
  readonly updated_at?: string | null
}

export type HostListSessions =
  | { readonly sessions: readonly HostSession[] }
  | { readonly kind: "ok"; readonly sessions: readonly HostSession[] }
  | { readonly kind: "ok"; readonly data: { readonly sessions: readonly HostSession[] } }
  | { readonly kind: "error"; readonly error: unknown }

export type AddressBookHost = {
  readonly socket: string
  /** Result of this call's list_sessions probe. */
  readonly list_sessions?: HostListSessions
  /** Backward-compatible shorthand for callers that already unwrap the probe. */
  readonly result?: HostListSessions
  readonly error?: unknown
  /** What serves the endpoint; `rpc_host` when absent. */
  readonly endpoint_kind?: EndpointKind
  /** The engine's liveness verdict for the endpoint (`host status --all` `alive`/`reason`), when it gave one. */
  readonly alive?: boolean
  readonly reason?: "live_unresponsive" | "dead" | null
  /** The legacy (non-shard) host socket, whose sessions are daemon sessions. */
  readonly legacy?: boolean
}

export type AddressEndpoint = {
  readonly kind: EndpointKind
  readonly socket: string
  readonly routing_id: string | null
}

/** Where a thread runs: a terminal, a Desktop thread shard, a task child, or the shared daemon. */
export type ThreadSurface = "tui" | "desktop" | "child" | "daemon"

/**
 * senpi's surface for a session, from what serves it: a terminal control endpoint is `tui`; on a host,
 * a worker session or a per-parent `p-*` shard is a task `child`, a per-thread `i-*` shard is a
 * `desktop` thread, and the legacy host's interactive sessions are `daemon` sessions.
 */
export function deriveSurface(endpointKind: EndpointKind | undefined, sessionKind: string | undefined, socket: string): ThreadSurface {
  if (endpointKind === "tui") return "tui"
  if (sessionKind === "worker") return "child"
  const name = basename(socket)
  if (name.startsWith("i-")) return "desktop"
  if (name.startsWith("p-")) return "child"
  return "daemon"
}

export type DiskSession = {
  readonly durable_id: string
  readonly name: string | null
  readonly cwd: string
  readonly created_at: string
  readonly updated_at: string | null
  readonly session_path: string
  /** Optional ownership hint when disk roots are associated with a host. */
  readonly source_host: string | null
  /** Text of the first user message, when the session has one; the title of an unnamed thread. */
  readonly first_user_text?: string
}

/**
 * Cross-project address record. The duplicated snake-case summary fields are
 * deliberate: `thread_id`, `status`, `created_at`, and `updated_at` let the
 * addressing layer consume named entries without translating their identity.
 */
export type AddressEntry = {
  readonly durable_id: string
  readonly routing_id: string | null
  readonly name: string | null
  readonly cwd: string
  readonly status: ThreadStatus
  readonly liveness: ThreadStatus
  readonly source_host: string | null
  readonly session_path: string | null
  readonly created_at: string
  readonly updated_at: string | null
  readonly thread_id: string
  readonly error_note?: string
  /** The endpoint that serves (or last served) the thread; `null` for a session no endpoint names. */
  readonly endpoint: AddressEndpoint | null
  readonly surface: ThreadSurface | null
  /** The endpoint's liveness verdict: `true` only while an endpoint that answered lists the session. */
  readonly alive: boolean
  /** What a listing shows: the name, else the first user message's opening, never the durable id. */
  readonly title: string | null
}

export type AssembleAddressBookOptions = {
  /** Timestamp used only when a live-only RPC record carries no disk metadata. */
  readonly assembled_at?: string
  /** Reads a live session's file for the name and timestamps its endpoint did not report. */
  readonly facts?: (sessionPath: string) => SessionFacts | null
}

export type ScanDiskSessionsOptions = {
  /** Associates every session under this root with one RPC host endpoint. */
  readonly source_host?: string
}

function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null) {
    const message = (value as { message?: unknown }).message
    if (typeof message === "string") return message
    const nested = (value as { error?: unknown }).error
    if (nested !== undefined) return errorMessage(nested)
  }
  return String(value)
}

function hostOutcome(host: AddressBookHost): HostListSessions | undefined {
  return host.list_sessions ?? host.result
}

function hostSessions(host: AddressBookHost): readonly HostSession[] | null {
  if (host.error !== undefined) return null
  const result = hostOutcome(host)
  if (result === undefined || ("kind" in result && result.kind === "error")) return null
  if ("data" in result) return result.data.sessions
  return result.sessions
}

function hostFailure(host: AddressBookHost): string | null {
  if (host.reason === "live_unresponsive") return "live_unresponsive"
  if (host.error !== undefined) return errorMessage(host.error)
  const result = hostOutcome(host)
  if (result === undefined) return "host unavailable"
  if ("kind" in result && result.kind === "error") return errorMessage(result.error)
  return null
}

function validTimestamp<T extends string | null>(value: unknown, fallback: T): string | T {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function fromDisk(session: DiskSession, host: AddressBookHost | undefined, failure?: string): AddressEntry {
  const endpoint = session.source_host === null ? null : { kind: host?.endpoint_kind ?? "rpc_host", socket: session.source_host, routing_id: null }
  return {
    durable_id: session.durable_id,
    routing_id: null,
    name: session.name,
    cwd: session.cwd,
    status: "resumable",
    liveness: "resumable",
    source_host: session.source_host,
    session_path: session.session_path,
    created_at: session.created_at,
    updated_at: session.updated_at,
    thread_id: session.durable_id,
    ...(failure === undefined ? {} : { error_note: failure }),
    endpoint,
    surface: endpoint === null ? null : deriveSurface(endpoint.kind, undefined, endpoint.socket),
    alive: false,
    title: threadTitle(session.name, session.first_user_text),
  }
}

/**
 * Assemble one fresh view. This function retains no process state: host
 * liveness is recomputed solely from this call's host results and durable disk
 * sessions are the only fallback when a host disappears.
 */
export function assembleAddressBook(
  hosts: readonly AddressBookHost[],
  diskSessions: readonly DiskSession[],
  opts: AssembleAddressBookOptions = {},
): AddressEntry[] {
  const assembledAt = opts.assembled_at ?? new Date().toISOString()
  const byDurableId = new Map<string, AddressEntry>()
  const failures = new Map<string, string>()
  const bySocket = new Map(hosts.map((host) => [host.socket, host]))

  for (const host of hosts) {
    const failure = hostFailure(host)
    if (failure !== null) failures.set(host.socket, failure)
  }

  for (const session of diskSessions) {
    if (session.durable_id.length === 0) continue
    const failure = session.source_host === null ? undefined : failures.get(session.source_host)
    byDurableId.set(session.durable_id, fromDisk(session, session.source_host === null ? undefined : bySocket.get(session.source_host), failure))
  }

  for (const host of hosts) {
    const sessions = hostSessions(host)
    if (sessions === null) continue
    for (const session of sessions) {
      if (session.status === "closed") continue
      // A terminal endpoint lists its one session by its durable id: there is no routing layer.
      const durableId = session.durableSessionId ?? (host.endpoint_kind === "tui" ? session.sessionId : undefined)
      if (typeof durableId !== "string" || durableId.length === 0) continue
      const disk = byDurableId.get(durableId)
      const sessionPath = session.sessionPath ?? disk?.session_path ?? null
      const reported = { name: session.name ?? null, created: session.created_at ?? session.createdAt, updated: session.updated_at ?? session.updatedAt }
      const needsFacts = reported.name === null || typeof reported.created !== "string" || typeof reported.updated !== "string"
      const facts = needsFacts && sessionPath !== null ? (opts.facts?.(sessionPath) ?? null) : null
      const createdAt = validTimestamp(reported.created, facts?.created_at ?? disk?.created_at ?? assembledAt)
      const updatedAt = validTimestamp(reported.updated, facts === null ? (disk?.updated_at ?? null) : facts.updated_at)
      const name = reported.name ?? disk?.name ?? facts?.name ?? null
      byDurableId.set(durableId, {
        durable_id: durableId,
        routing_id: session.sessionId,
        name,
        cwd: session.cwd,
        status: "live",
        liveness: "live",
        source_host: host.socket,
        session_path: sessionPath,
        created_at: createdAt,
        updated_at: updatedAt,
        thread_id: durableId,
        endpoint: { kind: host.endpoint_kind ?? "rpc_host", socket: host.socket, routing_id: session.sessionId },
        surface: deriveSurface(host.endpoint_kind, session.kind, host.socket),
        alive: host.alive !== false,
        title: threadTitle(name, facts?.first_user_text) ?? disk?.title ?? null,
      })
    }
  }

  return [...byDurableId.values()].sort((left, right) => {
    if (left.updated_at !== right.updated_at) return left.updated_at === null ? 1 : right.updated_at === null ? -1 : left.updated_at < right.updated_at ? 1 : -1
    return left.durable_id.localeCompare(right.durable_id)
  })
}

/** Convert nullable display names to the addressing layer's empty-name form. */
export function toThreadAddressEntries(entries: readonly AddressEntry[]): ThreadAddressEntry[] {
  return entries.map((entry) => ({
    thread_id: entry.thread_id,
    name: entry.name ?? "",
    status: entry.status,
    cwd: entry.cwd,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
  }))
}

/**
 * The gateway engine's view of the same entries: a thread is `routable` only while an endpoint that
 * answered lists it; a suspended or unanswering endpoint stays `live_unresponsive` (never treated as
 * gone), everything else is `dead` and gets `queued_offline`.
 */
export function toGatewayAddressEntries(entries: readonly AddressEntry[]): GatewayAddressEntry[] {
  return entries.map((entry) => ({
    thread_id: entry.thread_id,
    name: entry.name ?? "",
    status: entry.status,
    cwd: entry.cwd,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    endpoint: entry.endpoint,
    liveness: entry.alive ? "routable" : entry.error_note === "live_unresponsive" ? "live_unresponsive" : "dead",
  }))
}

/** One session file's durable identity, or null when the file is unreadable or has no header. */
export function readDiskSession(path: string, sourceHost: string | null): DiskSession | null {
  let content: string
  let modified: string
  try {
    content = readFileSync(path, "utf8")
    modified = statSync(path).mtime.toISOString()
  } catch {
    return null
  }

  const { header, name, first_user_text: firstUserText, newest_timestamp: latestTimestamp } = summarizeSessionEntries(parseSessionLines(content))
  if (header === null || typeof header.id !== "string" || typeof header.cwd !== "string") return null
  return {
    durable_id: header.id,
    name,
    cwd: header.cwd,
    created_at: validTimestamp(header.timestamp, modified),
    updated_at: latestTimestamp || null,
    session_path: path,
    source_host: sourceHost,
    ...(firstUserText === null ? {} : { first_user_text: firstUserText }),
  }
}

export type FindDiskSessionsOptions = {
  /** Match a name in every workspace; otherwise only the session directories of `workspaceRoots` are read. */
  readonly all_scope?: boolean
  /** The caller's workspace as paths (its root, the git top level, their realpaths); a session directory under one of them is read for names. */
  readonly workspaceRoots?: readonly string[]
}

/** senpi's session directory name for a cwd (`getDefaultSessionDirPath`), without the closing `--`: every cwd under `root` starts with it. */
function sessionDirectoryPrefix(root: string): string {
  return `--${resolve(root).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}-`
}

function diskSessionFromFacts(path: string): DiskSession | null {
  const facts = readSessionFacts(path)
  if (facts === null) return null
  return {
    durable_id: facts.durable_id,
    name: facts.name,
    cwd: facts.cwd,
    created_at: facts.created_at,
    updated_at: facts.updated_at,
    session_path: path,
    source_host: null,
    ...(facts.first_user_text === null ? {} : { first_user_text: facts.first_user_text }),
  }
}

/**
 * The session files an address names, for a session no endpoint lists (its terminal exited, was
 * killed, or stopped before the caller ever saw it). A durable id is found by the file name senpi
 * gives every session (`<timestamp>_<id>.jsonl`): a directory listing, no transcript is read. Any
 * other address is matched against each file's last `/name`, read through `readSessionFacts` (two
 * bounded windows per file) and, unless `all_scope`, only in the session directories of the caller's
 * workspace; `resolveTarget` still judges the scope of what is returned. `source_host` is null: no
 * endpoint serves these sessions.
 */
export function findDiskSessions(sessionsDir: string, address: string, opts: FindDiskSessionsOptions = {}): DiskSession[] {
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(sessionsDir, { withFileTypes: true })
      .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && /^--.*--$/.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }
  const files = new Map<string, readonly string[]>()
  const filesOf = (dir: string): readonly string[] => {
    let listed = files.get(dir)
    if (listed === undefined) {
      try {
        listed = readdirSync(join(sessionsDir, dir)).filter((name) => name.endsWith(".jsonl"))
      } catch {
        listed = []
      }
      files.set(dir, listed)
    }
    return listed
  }

  const idSuffix = `_${address}.jsonl`
  const byId = projectDirs.flatMap((dir) => filesOf(dir).flatMap((name) => {
    if (!name.endsWith(idSuffix)) return []
    const session = diskSessionFromFacts(join(sessionsDir, dir, name))
    return session !== null && session.durable_id === address ? [session] : []
  }))
  if (byId.length > 0) return byId

  const wanted = normalizeThreadName(address)
  if (wanted.length === 0) return []
  const prefixes = opts.all_scope === true ? undefined : (opts.workspaceRoots ?? []).map(sessionDirectoryPrefix)
  const readable = prefixes === undefined ? projectDirs : projectDirs.filter((dir) => prefixes.some((prefix) => dir.startsWith(prefix)))
  return readable.flatMap((dir) => filesOf(dir).flatMap((name) => {
    const session = diskSessionFromFacts(join(sessionsDir, dir, name))
    return session !== null && session.name !== null && normalizeThreadName(session.name) === wanted ? [session] : []
  }))
}

/**
 * Scan the `sessions/--<encoded-cwd>--/*.jsonl` layout. Directory names are
 * only a traversal boundary; cwd and durable identity always come from the
 * JSONL header, avoiding the encoding's intentionally lossy dash replacement.
 */
export function scanDiskSessions(
  sessionsDir: string,
  opts: ScanDiskSessionsOptions = {},
): DiskSession[] {
  const found: DiskSession[] = []
  let projectDirs
  try {
    projectDirs = readdirSync(sessionsDir, { withFileTypes: true })
  } catch {
    return found
  }

  for (const projectDir of projectDirs) {
    if ((!projectDir.isDirectory() && !projectDir.isSymbolicLink()) || !/^--.*--$/.test(projectDir.name)) continue
    const dir = join(sessionsDir, projectDir.name)
    let files
    try {
      files = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue
      const session = readDiskSession(join(dir, file.name), opts.source_host ?? null)
      if (session !== null) found.push(session)
    }
  }

  return found.sort((left, right) => {
    if (left.updated_at !== right.updated_at) return left.updated_at === null ? 1 : right.updated_at === null ? -1 : left.updated_at < right.updated_at ? 1 : -1
    return left.durable_id.localeCompare(right.durable_id)
  })
}
