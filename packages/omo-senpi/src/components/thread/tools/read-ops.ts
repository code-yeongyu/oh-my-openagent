import { listDiskSessions, toThreadAddressEntries } from "../address-book"
import { workspaceDirectories, workspaceEntries } from "../addressing"
import type { ThreadReadInput, ThreadState, ThreadToolResult } from "../contracts"
import { locateControl } from "../control/locate"
import { controlIdentity } from "../control/port"
import { readTranscript, type ThreadTranscriptEntry } from "../reader"
import { threadLink } from "../thread-link"
import {
  addressBook,
  degradedSummary,
  failure,
  listedStates,
  sendAddressBook,
  summary,
  transcriptRole,
} from "./internals"
import type { ThreadHostSession, ThreadHostView, ThreadToolSurfaceOptions } from "./ports"

/**
 * `thread_list` over one host view. Default scope is the caller's workspace, the same test
 * thread_send applies before it delivers; the address book itself spans every workspace the host
 * knows. A session no engine holds is still a thread, listed `inactive` from its JSONL: one whose
 * endpoint stopped answering (with the endpoint's failure in error_note), and one whose session file
 * is in the scanned session directories (the caller's workspace, every workspace with `all_scope`;
 * the newest `DISK_LIST_MAX_SESSIONS` files, `inactive_truncated` when more were there) after its
 * engine closed it. `states` filters the rows; the default lists every state but archived.
 */
export function listThreads(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  allScope: boolean | undefined,
  states?: readonly ThreadState[],
): ThreadToolResult {
  const root = options.callerWorkspaceRoot()
  const sessionsDirectory = options.sessionsDirectory?.()
  const scanned =
    sessionsDirectory === undefined
      ? { sessions: [], truncated: false }
      : listDiskSessions(sessionsDirectory, { all_scope: allScope, workspaceRoots: workspaceDirectories(root) })
  const book = addressBook(options, current, scanned.sessions)
  const scoped = workspaceEntries(toThreadAddressEntries(book), root)
  const inScope = (threadId: string) => allScope === true || scoped.some((entry) => entry.thread_id === threadId)
  const visible = current.sessions.filter((session) => inScope(session.durableSessionId ?? session.sessionId))
  const listed = new Set(visible.map((session) => session.durableSessionId ?? session.sessionId))
  const entryOf = (session: ThreadHostSession) =>
    book.find(
      (entry) =>
        entry.thread_id === (session.durableSessionId ?? session.sessionId) &&
        entry.source_host === (session.socket ?? entry.source_host),
    )
  const scannedIds = new Set(scanned.sessions.map((session) => session.durable_id))
  const inactive = book.filter(
    (entry) =>
      entry.status !== "live" &&
      (entry.error_note !== undefined || scannedIds.has(entry.thread_id)) &&
      !listed.has(entry.thread_id) &&
      inScope(entry.thread_id),
  )
  const order = new Map(book.map((entry, index) => [entry.thread_id, index]))
  const shown = listedStates(states)
  const threads = [...visible.map((session) => summary(session, entryOf(session))), ...inactive.map(degradedSummary)]
    .filter((thread) => shown.has(thread.state))
    .sort(
      (left, right) =>
        (order.get(left.thread_id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.thread_id) ?? Number.MAX_SAFE_INTEGER),
    )
  return {
    kind: "ok",
    threads,
    scope: allScope === true ? "all" : "workspace",
    ...(scanned.truncated ? { inactive_truncated: true } : {}),
  }
}

/**
 * A first read takes the trailing window; a read that carries a cursor continues forward from it.
 * Tail mode ignores the cursor, so following next_cursor in tail mode returned the same slice again.
 */
function readWindow(value: ThreadReadInput): { mode: "tail" | "page"; max_bytes?: number; cursor?: string } {
  return { mode: value.cursor === undefined ? "tail" : "page", max_bytes: value.max_bytes, cursor: value.cursor }
}

/** `thread_read`: the live transcript through the thread's control, wherever it is held; else its JSONL when its endpoint here is dead. */
export async function readThread(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  value: ThreadReadInput,
  callerId: string,
): Promise<ThreadToolResult> {
  const located = await locateControl(options, current, value.thread, value.all_scope, callerId)
  if (located.kind === "error") return located.result
  if (located.kind === "not_live") return readDegraded(options, current, located.thread_id, value)
  const { control } = located
  const result = liveReadResult(control.thread_id, control.title, await control.getMessages(), value)
  return result.kind === "ok" ? { ...result, ...controlIdentity(control) } : result
}

/** A live session's transcript through the bounded reader; the same window rules on this device and on another one. */
export function liveReadResult(
  threadId: string,
  title: string | undefined,
  messages: readonly ThreadTranscriptEntry[],
  value: ThreadReadInput,
): ThreadToolResult {
  const live = readTranscript({ kind: "live", entries: () => messages }, readWindow(value))
  if (live.kind === "error") return { kind: "error", error: live.error }
  return {
    kind: "ok",
    thread_id: threadId,
    link: threadLink(threadId, title),
    items: live.items.map((item, index) => ({
      seq: index + 1,
      role: transcriptRole(item.role),
      content: JSON.stringify(item.content ?? item),
    })),
    truncated: live.truncated,
    ...(live.next_cursor === null ? {} : { next_cursor: live.next_cursor }),
    source: live.source,
  }
}

/**
 * A thread with no live owner is read from its JSONL: one whose endpoint is dead (the address book
 * carries the durable path and the endpoint's failure) or one an engine closed, whose session file
 * the address book finds. A thread with no session file stays `not_resumable`.
 */
function readDegraded(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  threadId: string,
  value: ThreadReadInput,
): ThreadToolResult {
  const entry = sendAddressBook(options, current, threadId, true).find((candidate) => candidate.thread_id === threadId)
  if (entry === undefined || entry.status === "live" || entry.session_path === null)
    return failure("not_resumable", "The thread has no live owner.", "Retry when the target is live.")
  const durable = readTranscript(
    { kind: "jsonl", path: entry.session_path, live_host_present: false },
    readWindow(value),
  )
  if (durable.kind === "error") return { kind: "error", error: durable.error }
  // A session file interleaves messages with bookkeeping (the session header, model and thinking
  // changes, names): only message entries are transcript, rendered with the live path's roles.
  const messages = durable.items.flatMap((item) => {
    const message = item.message
    if (item.type !== "message" || typeof message !== "object" || message === null || Array.isArray(message)) return []
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult" ? [message] : []
  })
  const items = messages.map((message, index) => ({
    seq: index + 1,
    role: transcriptRole(message.role),
    content: JSON.stringify(message.content ?? message),
  }))
  return {
    kind: "ok",
    thread_id: threadId,
    link: threadLink(threadId, entry.title),
    items,
    truncated: durable.truncated,
    ...(durable.next_cursor === null ? {} : { next_cursor: durable.next_cursor }),
    source: durable.source,
    source_incomplete: durable.source_incomplete,
    ...(entry.error_note === undefined ? {} : { error_note: entry.error_note }),
  }
}
