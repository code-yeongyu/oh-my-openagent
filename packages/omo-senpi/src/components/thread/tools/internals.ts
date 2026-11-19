import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import {
  assembleAddressBook,
  findDiskSessions,
  toThreadAddressEntries,
  type AddressEndpoint,
  type AddressEntry,
  type DiskSession,
  type ThreadSurface,
} from "../address-book"
import { resolveTarget, workspaceDirectories, type ThreadAddressEntry } from "../addressing"
import type {
  ThreadActivity,
  ThreadModel,
  ThreadRetryWait,
  ThreadState,
  ThreadToolName,
  ThreadToolResult,
  ThreadTranscriptItem,
} from "../contracts"
import { threadToolFailure, type ThreadErrorCode } from "../errors"
import { THREAD_TOOL_EXPOSURE, THREAD_TOOL_METADATA } from "../metadata"
import { readSessionFacts, threadTitle } from "../session-facts"
import { threadLink } from "../thread-link"
import {
  type ThreadHostSession,
  type ThreadHostView,
  type ThreadHostViewRequest,
  type ThreadSessionPort,
  type ThreadToolSurfaceOptions,
} from "./ports"
import { activityDetail, retryWait, threadModel, threadState } from "./thread-state"

// biome-ignore lint/suspicious/noExplicitAny: the tool definitions are heterogeneous by design.
export type AnyTool = ToolDefinition<any, any>
export type ToolOutput = AgentToolResult<{ readonly result: ThreadToolResult }>

export function failure(
  code: ThreadErrorCode,
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): ThreadToolResult {
  return { kind: "error", error: threadToolFailure(code, message, next, details) }
}

/** The answer to an operation whose earlier run under the same key may have acted: read before retrying. */
export function uncertainFailure(note: string | null): ThreadToolResult {
  return failure(
    "idempotency_uncertain",
    "The earlier operation may have been delivered.",
    "Read the target transcript before deciding whether to retry.",
    note === null ? undefined : { error_note: note },
  )
}

export function output(result: ThreadToolResult): ToolOutput {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    details: { result },
    ...(result.kind === "error" ? { isError: true } : {}),
  }
}

export type ThreadToolSummary = Omit<
  ThreadHostSession,
  | "name"
  | "status"
  | "createdAt"
  | "updatedAt"
  | "created_at"
  | "updated_at"
  | "archived"
  | "activity"
  | "error_code"
  | "turn_id"
  | "model"
  | "waiting"
> & {
  readonly thread_id: string
  readonly name: string
  /** Deprecated beside `state`: `resumable` when no engine holds the thread, else `live`. */
  readonly status: "live" | "resumable"
  readonly state: ThreadState
  /** The engine's finer activity of a held thread (senpi#6688); `state` folds it. */
  readonly activity?: ThreadActivity
  /** With `errored`: the failed turn's category. */
  readonly error_code?: string
  /** The current or most recent turn's id. */
  readonly turn_id?: string
  /** A running thread asleep between provider retries (senpi#7025). */
  readonly waiting_on?: ThreadRetryWait
  readonly model?: ThreadModel
  readonly created_at: string
  readonly updated_at: string | null
  readonly endpoint?: AddressEndpoint | null
  readonly surface?: ThreadSurface | null
  /** `[title](omo-thread://v1/<thread_id>)` (`thread-link.ts`): paste it when telling the user about this thread. */
  readonly link: string
}

export type ThreadToolMetadata = {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly exposure: typeof THREAD_TOOL_EXPOSURE
}

export function metadata(name: ThreadToolName): ThreadToolMetadata {
  const entry = THREAD_TOOL_METADATA.find((candidate) => candidate.name === name)
  if (entry === undefined) throw new Error(`missing thread metadata for ${name}`)
  return { name: entry.name, label: entry.label, description: entry.description, exposure: entry.exposure }
}

/**
 * One thread as the tools report it. The address book entry, when there is one, supplies what the
 * endpoint may not report: the real name (else the first user message's opening - never the durable
 * id), the header's creation time and the last entry's time, the endpoint and the surface.
 */
export function summary(session: ThreadHostSession, entry?: AddressEntry): ThreadToolSummary {
  const id = session.durableSessionId ?? session.sessionId
  const {
    name: _name,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    created_at: _created,
    updated_at: _updated,
    archived,
    activity,
    error_code,
    turn_id,
    model,
    waiting,
    ...rest
  } = session
  const created = entry?.created_at ?? session.created_at ?? session.createdAt ?? new Date().toISOString()
  const held = session.status !== "closed" && entry?.alive !== false
  return {
    ...rest,
    thread_id: id,
    name: entry?.title ?? threadTitle(session.name, null) ?? "",
    status: held ? "live" : "resumable",
    state: threadState({ archived, held, activity }),
    ...threadModel(model),
    ...activityDetail(held && archived !== true, activity, error_code, turn_id),
    ...retryWait(held && archived !== true && activity === "running", waiting),
    created_at: created,
    updated_at: entry === undefined ? (session.updated_at ?? session.updatedAt ?? created) : entry.updated_at,
    ...(entry === undefined ? {} : { endpoint: entry.endpoint, surface: entry.surface }),
    link: threadLink(id, entry?.title ?? threadTitle(session.name, null)),
  }
}

/**
 * One call's view of the host. A multi-endpoint surface answers it whole (`listView`); a host that
 * reaches one endpoint is that endpoint's listing, exactly as before endpoints were enumerated.
 * With `offline`, an endpoint that does not answer is a host without sessions, never a throw.
 */
export async function hostView(
  options: Omit<ThreadToolSurfaceOptions, "store">,
  request: ThreadHostViewRequest = {},
): Promise<ThreadHostView> {
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

export function addressBook(
  options: Omit<ThreadToolSurfaceOptions, "store">,
  view: ThreadHostView,
  extra: readonly DiskSession[] = [],
): AddressEntry[] {
  return assembleAddressBook(view.hosts, [...(options.diskSessions?.() ?? []), ...view.disk, ...extra], {
    facts: readSessionFacts,
  })
}

/**
 * The address book a send resolves `address` against: the endpoints' entries, plus - only when the
 * address names none of them - the session files on disk it names. A session no endpoint lists (its
 * terminal exited, was killed or stopped before this process saw it) is then still found by id or
 * name; its entry has no endpoint, so the gateway queues the send offline. Ambiguity and scope are
 * judged over the same entries as always. An exact durable id wins over every name, live or on disk:
 * when no endpoint lists the id, its session file is looked up even if a live session's name matches.
 */
export function sendAddressBook(
  options: Omit<ThreadToolSurfaceOptions, "store">,
  view: ThreadHostView,
  address: string,
  allScope?: boolean,
): AddressEntry[] {
  const book = addressBook(options, view)
  const sessionsDirectory = options.sessionsDirectory?.()
  if (sessionsDirectory === undefined || address === "self") return book
  const known = new Set(book.map((entry) => entry.durable_id))
  if (known.has(address)) return book
  const root = options.callerWorkspaceRoot()
  const resolved = resolveTarget(toThreadAddressEntries(book), address, {
    all_scope: allScope,
    callerWorkspaceRoot: root,
  })
  const idOnly = resolved.kind !== "error" || resolved.code !== "not_found"
  const found = findDiskSessions(sessionsDirectory, address, {
    all_scope: allScope,
    workspaceRoots: workspaceDirectories(root),
    id_only: idOnly,
  }).filter((session) => !known.has(session.durable_id))
  return found.length === 0 ? book : addressBook(options, view, found)
}

/** This device's send address book as the resolver asks it, for one address part at a time (`ResolveContext.localFor`). */
export const sendBookFor =
  (options: Omit<ThreadToolSurfaceOptions, "store">, view: ThreadHostView) =>
  (address: string): ThreadAddressEntry[] =>
    toThreadAddressEntries(sendAddressBook(options, view, address, true))

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
    state: threadState({ archived: entry.archived, held: false }),
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    endpoint: entry.endpoint,
    surface: entry.surface,
    link: threadLink(entry.thread_id, entry.title),
    ...(entry.error_note === undefined ? {} : { error_note: entry.error_note }),
  }
}

/** The per-session methods of the endpoint that listed `session`: routing ids are only unique per endpoint. */
export function sessionPort(options: ThreadToolSurfaceOptions, session: ThreadHostSession): ThreadSessionPort {
  return session.socket !== undefined && options.host.endpoint !== undefined
    ? options.host.endpoint(session.socket)
    : options.host
}

export function routingId(session: ThreadHostSession): string {
  return session.sessionId
}

/** One role vocabulary for both read paths: engine `toolResult` is `tool`; every other non-chat kind is `system`. */
export function transcriptRole(role: unknown): ThreadTranscriptItem["role"] {
  if (role === "user" || role === "assistant") return role
  return role === "toolResult" ? "tool" : "system"
}

export function targetSession(view: ThreadHostView, durableId: string): ThreadHostSession | undefined {
  return view.sessions.find((session) => (session.durableSessionId ?? session.sessionId) === durableId)
}
