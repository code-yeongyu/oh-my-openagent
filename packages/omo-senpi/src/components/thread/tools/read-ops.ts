import { workspaceEntries } from "../addressing"
import { withModels } from "../model-control"
import type { ThreadReadInput, ThreadToolResult } from "../contracts"
import { readTranscript } from "../reader"
import { addressBook, degradedSummary, failure, resolution, resolveEntries, routingId, sessionPort, summary, targetSession, transcriptRole } from "./internals"
import type { ThreadHostSession, ThreadHostView, ThreadToolSurfaceOptions } from "./ports"

/**
 * `thread_list` over one host view. Default scope is the caller's workspace, the same test
 * thread_send applies before it delivers; the address book itself spans every workspace the host
 * knows. A session whose endpoint stopped answering is still a thread: it is listed from its JSONL
 * as resumable, with the endpoint's failure in error_note, instead of silently vanishing.
 */
export async function listThreads(options: ThreadToolSurfaceOptions, current: ThreadHostView, allScope: boolean | undefined): Promise<ThreadToolResult> {
  const scoped = workspaceEntries(resolveEntries(options, current), options.callerWorkspaceRoot())
  const inScope = (threadId: string) => allScope === true || scoped.some((entry) => entry.thread_id === threadId)
  const visible = current.sessions.filter((session) => inScope(session.durableSessionId ?? session.sessionId))
  const book = addressBook(options, current)
  const entryOf = (session: ThreadHostSession) => book.find((entry) => entry.thread_id === (session.durableSessionId ?? session.sessionId) && entry.source_host === (session.socket ?? entry.source_host))
  const degraded = book.filter((entry) => entry.error_note !== undefined && entry.status !== "live" && inScope(entry.thread_id))
  const order = new Map(book.map((entry, index) => [entry.thread_id, index]))
  const threads = [...visible.map((session) => summary(session, entryOf(session))), ...degraded.map(degradedSummary)]
    .sort((left, right) => (order.get(left.thread_id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.thread_id) ?? Number.MAX_SAFE_INTEGER))
  return { kind: "ok", threads: await withModels(options, threads), scope: allScope === true ? "all" : "workspace" }
}

/** `thread_read` over one host view: the live transcript from the session's endpoint, else its JSONL when that endpoint is dead. */
export async function readThread(options: ThreadToolSurfaceOptions, current: ThreadHostView, value: ThreadReadInput, callerId: string): Promise<ThreadToolResult> {
  const resolved = resolution(options, resolveEntries(options, current), value.thread, callerId, value.all_scope)
  if (resolved.kind === "error") return { kind: "error", error: resolved }
  const session = targetSession(current, resolved.entry.thread_id)
  const read = session === undefined ? readDegraded(options, current, resolved.entry.thread_id, value) : await readLive(options, session, resolved.entry.thread_id, value)
  if (read.kind !== "ok") return read
  const [withModel] = await withModels(options, [read as Extract<ThreadToolResult, { thread_id: string }>])
  return withModel as ThreadToolResult
}

async function readLive(options: ThreadToolSurfaceOptions, session: ThreadHostSession, threadId: string, value: ThreadReadInput): Promise<ThreadToolResult> {
  const messages = await sessionPort(options, session).getMessages(routingId(session))
  const live = readTranscript({ kind: "live", entries: () => messages }, { mode: "tail", max_bytes: value.max_bytes, cursor: value.cursor })
  if (live.kind === "error") return { kind: "error", error: live.error }
  return {
    kind: "ok",
    thread_id: threadId,
    items: live.items.map((item, index) => ({ seq: index + 1, role: transcriptRole(item.role), content: JSON.stringify(item.content ?? item) })),
    truncated: live.truncated,
    ...(live.next_cursor === null ? {} : { next_cursor: live.next_cursor }),
    source: live.source,
  }
}

/**
 * A thread with no live owner is read from its JSONL only when its ENDPOINT is dead: the address
 * book then carries the durable path and the endpoint's failure. Any other non-live thread stays
 * `not_resumable`, as before endpoints were enumerated.
 */
function readDegraded(options: ThreadToolSurfaceOptions, current: ThreadHostView, threadId: string, value: ThreadReadInput): ThreadToolResult {
  const entry = addressBook(options, current).find((candidate) => candidate.thread_id === threadId)
  if (entry === undefined || entry.error_note === undefined || entry.session_path === null) return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
  const durable = readTranscript({ kind: "jsonl", path: entry.session_path, live_host_present: false }, { mode: "tail", max_bytes: value.max_bytes, cursor: value.cursor })
  if (durable.kind === "error") return { kind: "error", error: durable.error }
  // A session file interleaves messages with bookkeeping (the session header, model and thinking
  // changes, names): only message entries are transcript, rendered with the live path's roles.
  const messages = durable.items.flatMap((item) => {
    const message = item.message
    if (item.type !== "message" || typeof message !== "object" || message === null || Array.isArray(message)) return []
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult" ? [message] : []
  })
  const items = messages.map((message, index) => ({ seq: index + 1, role: transcriptRole(message.role), content: JSON.stringify(message.content ?? message) }))
  return { kind: "ok", thread_id: threadId, items, truncated: durable.truncated, ...(durable.next_cursor === null ? {} : { next_cursor: durable.next_cursor }), source: durable.source, source_incomplete: durable.source_incomplete, error_note: entry.error_note }
}
