import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { assembleAddressBook, findDiskSessions, toThreadAddressEntries, type AddressEndpoint, type AddressEntry, type DiskSession, type ThreadSurface } from "../address-book"
import { resolveTarget, workspaceDirectories, type ThreadAddressEntry } from "../addressing"
import type { ThreadToolName, ThreadToolResult, ThreadTranscriptItem } from "../contracts"
import { threadToolFailure, type ThreadErrorCode } from "../errors"
import { THREAD_TOOL_SEARCH_METADATA } from "../metadata"
import { readSessionFacts, threadTitle } from "../session-facts"
import { UNKNOWN_CALLER, type ThreadHostSession, type ThreadHostView, type ThreadHostViewRequest, type ThreadSessionPort, type ThreadToolSurfaceOptions } from "./ports"

// biome-ignore lint/suspicious/noExplicitAny: the tool definitions are heterogeneous by design.
export type AnyTool = ToolDefinition<any, any>
export type ToolOutput = AgentToolResult<{ readonly result: ThreadToolResult }>

export function failure(code: ThreadErrorCode, message: string, next: string, details?: Readonly<Record<string, unknown>>): ThreadToolResult {
  return { kind: "error", error: threadToolFailure(code, message, next, details) }
}

export function output(result: ThreadToolResult): ToolOutput {
  return { content: [{ type: "text", text: JSON.stringify(result) }], details: { result } }
}

export type ThreadToolSummary = Omit<ThreadHostSession, "name" | "status" | "createdAt" | "updatedAt" | "created_at" | "updated_at"> & {
  readonly thread_id: string
  readonly name: string
  readonly status: "live" | "resumable"
  readonly created_at: string
  readonly updated_at: string | null
  readonly endpoint?: AddressEndpoint | null
  readonly surface?: ThreadSurface | null
  readonly alive?: boolean
}

export type ThreadToolMetadata = {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly exposure: "search"
  readonly searchText: string
  readonly searchKeywords: readonly string[]
  readonly searchGroup: string
  readonly allowLazyActivation: true
}

export function metadata(name: ThreadToolName): ThreadToolMetadata {
  const entry = THREAD_TOOL_SEARCH_METADATA.find((candidate) => candidate.name === name)
  if (entry === undefined) throw new Error(`missing thread metadata for ${name}`)
  return {
    name: entry.name, label: entry.label, description: entry.description,
    exposure: entry.exposure, searchText: entry.searchText, searchKeywords: entry.searchKeywords,
    searchGroup: entry.group, allowLazyActivation: entry.allowLazyActivation,
  }
}

/**
 * One thread as the tools report it. The address book entry, when there is one, supplies what the
 * endpoint may not report: the real name (else the first user message's opening - never the durable
 * id), the header's creation time and the last entry's time, the endpoint and the surface.
 */
export function summary(session: ThreadHostSession, entry?: AddressEntry): ThreadToolSummary {
  const id = session.durableSessionId ?? session.sessionId
  const { name: _name, createdAt: _createdAt, updatedAt: _updatedAt, created_at: _created, updated_at: _updated, ...rest } = session
  const created = entry?.created_at ?? session.created_at ?? session.createdAt ?? new Date().toISOString()
  return {
    ...rest,
    thread_id: id,
    name: entry?.title ?? threadTitle(session.name, null) ?? "",
    status: session.status === "closed" ? "resumable" : "live",
    created_at: created,
    updated_at: entry === undefined ? (session.updated_at ?? session.updatedAt ?? created) : entry.updated_at,
    ...(entry === undefined ? {} : { endpoint: entry.endpoint, surface: entry.surface, alive: entry.alive }),
  }
}

/**
 * One call's view of the host. A multi-endpoint surface answers it whole (`listView`); a host that
 * reaches one endpoint is that endpoint's listing, exactly as before endpoints were enumerated.
 * With `offline`, an endpoint that does not answer is a host without sessions, never a throw.
 */
export async function hostView(options: ThreadToolSurfaceOptions, request: ThreadHostViewRequest = {}): Promise<ThreadHostView> {
  if (options.host.listView !== undefined) return await options.host.listView(request)
  let sessions: readonly ThreadHostSession[]
  try {
    sessions = await options.host.listSessions()
  } catch (error) {
    if (request.offline !== true) throw error
    return { sessions: [], hosts: [{ socket: options.host.socket, error }], disk: [] }
  }
  return { sessions, hosts: [{ socket: options.host.socket, list_sessions: { sessions } }], disk: [] }
}

export function addressBook(options: ThreadToolSurfaceOptions, view: ThreadHostView, extra: readonly DiskSession[] = []): AddressEntry[] {
  return assembleAddressBook(view.hosts, [...(options.diskSessions?.() ?? []), ...view.disk, ...extra], { facts: readSessionFacts })
}

/**
 * The address book a send resolves `address` against: the endpoints' entries, plus - only when the
 * address names none of them - the session files on disk it names. A session no endpoint lists (its
 * terminal exited, was killed or stopped before this process saw it) is then still found by id or
 * name; its entry has no endpoint, so the gateway queues the send offline. Ambiguity and scope are
 * judged over the same entries as always.
 */
export function sendAddressBook(options: ThreadToolSurfaceOptions, view: ThreadHostView, address: string, allScope?: boolean): AddressEntry[] {
  const book = addressBook(options, view)
  const sessionsDirectory = options.sessionsDirectory?.()
  if (sessionsDirectory === undefined || address === "self") return book
  const root = options.callerWorkspaceRoot()
  const resolved = resolveTarget(toThreadAddressEntries(book), address, { all_scope: allScope, callerWorkspaceRoot: root })
  if (resolved.kind !== "error" || resolved.code !== "not_found") return book
  const known = new Set(book.map((entry) => entry.durable_id))
  const found = findDiskSessions(sessionsDirectory, address, { all_scope: allScope, workspaceRoots: workspaceDirectories(root) }).filter((session) => !known.has(session.durable_id))
  return found.length === 0 ? book : addressBook(options, view, found)
}

/** A thread listed from disk because its endpoint is dead: resumable, addressed by its durable id. */
export function degradedSummary(entry: AddressEntry): ThreadToolSummary & { readonly error_note?: string } {
  return {
    sessionId: entry.durable_id,
    durableSessionId: entry.durable_id,
    ...(entry.session_path === null ? {} : { sessionPath: entry.session_path }),
    ...(entry.source_host === null ? {} : { socket: entry.source_host }),
    cwd: entry.cwd,
    thread_id: entry.thread_id,
    name: entry.title ?? "",
    status: "resumable",
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    endpoint: entry.endpoint,
    surface: entry.surface,
    alive: entry.alive,
    ...(entry.error_note === undefined ? {} : { error_note: entry.error_note }),
  }
}

export function resolveEntries(options: ThreadToolSurfaceOptions, view: ThreadHostView): ThreadAddressEntry[] {
  return toThreadAddressEntries(addressBook(options, view))
}

/** The per-session methods of the endpoint that listed `session`: routing ids are only unique per endpoint. */
export function sessionPort(options: ThreadToolSurfaceOptions, session: ThreadHostSession): ThreadSessionPort {
  return session.socket !== undefined && options.host.endpoint !== undefined ? options.host.endpoint(session.socket) : options.host
}

export function resolution(options: ThreadToolSurfaceOptions, entries: readonly ThreadAddressEntry[], target: string, callerId: string, allScope?: boolean) {
  if (target === "self") {
    // UNKNOWN_CALLER stands for an ABSENT identity, so it must never match an entry: a thread
    // that happened to carry it as its durable id would otherwise be renamed or re-modelled by
    // any caller whose host passes no execution context.
    const caller = callerId === UNKNOWN_CALLER ? undefined : entries.find((entry) => entry.thread_id === callerId)
    if (caller === undefined) return { kind: "error" as const, ...threadToolFailure("caller_context_missing", "The caller's durable session id is not in the thread address book.", "Call thread_list and pass an explicit thread_id, or retry from a session with caller context.") }
    target = caller.thread_id
  }
  return resolveTarget(entries, target, { all_scope: allScope, callerWorkspaceRoot: options.callerWorkspaceRoot() })
}

export function routingId(session: ThreadHostSession): string { return session.sessionId }

/** One role vocabulary for both read paths: engine `toolResult` is `tool`; every other non-chat kind is `system`. */
export function transcriptRole(role: unknown): ThreadTranscriptItem["role"] {
  if (role === "user" || role === "assistant") return role
  return role === "toolResult" ? "tool" : "system"
}

export function targetSession(view: ThreadHostView, durableId: string): ThreadHostSession | undefined {
  return view.sessions.find((session) => (session.durableSessionId ?? session.sessionId) === durableId)
}

