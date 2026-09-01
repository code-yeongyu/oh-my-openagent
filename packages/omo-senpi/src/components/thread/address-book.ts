import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import type { ThreadAddressEntry } from "./addressing"
import type { ThreadStatus } from "./contracts"

export type HostSessionStatus = "opening" | "open" | "closing" | "closed"

export type HostSession = {
  readonly sessionId: string
  readonly durableSessionId?: string
  readonly sessionPath?: string
  readonly cwd: string
  readonly name?: string
  readonly status: HostSessionStatus
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly created_at?: string
  readonly updated_at?: string
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
}

export type DiskSession = {
  readonly durable_id: string
  readonly name: string | null
  readonly cwd: string
  readonly created_at: string
  readonly updated_at: string
  readonly session_path: string
  /** Optional ownership hint when disk roots are associated with a host. */
  readonly source_host: string | null
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
  readonly updated_at: string
  readonly thread_id: string
  readonly error_note?: string
}

export type AssembleAddressBookOptions = {
  /** Timestamp used only when a live-only RPC record carries no disk metadata. */
  readonly assembled_at?: string
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
  if (host.error !== undefined) return errorMessage(host.error)
  const result = hostOutcome(host)
  if (result === undefined) return "host unavailable"
  if ("kind" in result && result.kind === "error") return errorMessage(result.error)
  return null
}

function validTimestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

function fromDisk(session: DiskSession, failure?: string): AddressEntry {
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

  for (const host of hosts) {
    const failure = hostFailure(host)
    if (failure !== null) failures.set(host.socket, failure)
  }

  for (const session of diskSessions) {
    if (session.durable_id.length === 0) continue
    const failure = session.source_host === null ? undefined : failures.get(session.source_host)
    byDurableId.set(session.durable_id, fromDisk(session, failure))
  }

  for (const host of hosts) {
    const sessions = hostSessions(host)
    if (sessions === null) continue
    for (const session of sessions) {
      if (session.status === "closed") continue
      const durableId = session.durableSessionId
      if (typeof durableId !== "string" || durableId.length === 0) continue
      const disk = byDurableId.get(durableId)
      const createdAt = validTimestamp(session.created_at ?? session.createdAt, disk?.created_at ?? assembledAt)
      const updatedAt = validTimestamp(session.updated_at ?? session.updatedAt, disk?.updated_at ?? createdAt)
      byDurableId.set(durableId, {
        durable_id: durableId,
        routing_id: session.sessionId,
        name: session.name ?? disk?.name ?? null,
        cwd: session.cwd,
        status: "live",
        liveness: "live",
        source_host: host.socket,
        session_path: session.sessionPath ?? disk?.session_path ?? null,
        created_at: createdAt,
        updated_at: updatedAt,
        thread_id: durableId,
      })
    }
  }

  return [...byDurableId.values()].sort((left, right) => {
    if (left.updated_at !== right.updated_at) return left.updated_at < right.updated_at ? 1 : -1
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

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readDiskSession(path: string, sourceHost: string | null): DiskSession | null {
  let content: string
  let modified: string
  try {
    content = readFileSync(path, "utf8")
    modified = statSync(path).mtime.toISOString()
  } catch {
    return null
  }

  let header: JsonRecord | null = null
  let name: string | null = null
  let latestTimestamp = ""
  for (const line of content.split("\n")) {
    if (line.trim().length === 0) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRecord(entry)) continue
    if (header === null && entry.type === "session" && typeof entry.id === "string") header = entry
    if (entry.type === "session_info") {
      name = typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name.trim() : null
    }
    if (typeof entry.timestamp === "string" && entry.timestamp > latestTimestamp) latestTimestamp = entry.timestamp
  }

  if (header === null || typeof header.id !== "string" || typeof header.cwd !== "string") return null
  const createdAt = validTimestamp(header.timestamp, modified)
  return {
    durable_id: header.id,
    name,
    cwd: header.cwd,
    created_at: createdAt,
    updated_at: latestTimestamp || modified,
    session_path: path,
    source_host: sourceHost,
  }
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
    if (left.updated_at !== right.updated_at) return left.updated_at < right.updated_at ? 1 : -1
    return left.durable_id.localeCompare(right.durable_id)
  })
}
