import { workspaceEntries } from "../addressing"
import type { ThreadReadInput, ThreadToolResult, ThreadWaitOutcome } from "../contracts"
import { locateControl } from "../control/locate"
import { controlIdentity, controlRefusalOf, type SessionControl } from "../control/port"
import { isEntryCursor, staleEntryCursor } from "../paged-reader"
import { readTranscript, type ThreadTranscriptEntry } from "../reader"
import { threadLink } from "../thread-link"
import {
  addressBook,
  degradedSummary,
  failure,
  resolveEntries,
  sendAddressBook,
  summary,
  transcriptRole,
} from "./internals"
import { threadRow } from "./thread-row"
import type { ThreadHostSession, ThreadHostView, ThreadToolSurfaceOptions } from "./ports"

/**
 * `thread_list` over one host view. Default scope is the caller's workspace, the same test
 * thread_send applies before it delivers; the address book itself spans every workspace the host
 * knows. A session whose endpoint stopped answering is still a thread: it is listed from its JSONL
 * as resumable, with the endpoint's failure in error_note, instead of silently vanishing.
 */
export function listThreads(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  allScope: boolean | undefined,
): ThreadToolResult {
  const scoped = workspaceEntries(resolveEntries(options, current), options.callerWorkspaceRoot())
  const inScope = (threadId: string) => allScope === true || scoped.some((entry) => entry.thread_id === threadId)
  const visible = current.sessions.filter((session) => inScope(session.durableSessionId ?? session.sessionId))
  const book = addressBook(options, current)
  const entryOf = (session: ThreadHostSession) =>
    book.find(
      (entry) =>
        entry.thread_id === (session.durableSessionId ?? session.sessionId) &&
        entry.source_host === (session.socket ?? entry.source_host),
    )
  const degraded = book.filter(
    (entry) => entry.error_note !== undefined && entry.status !== "live" && inScope(entry.thread_id),
  )
  const order = new Map(book.map((entry, index) => [entry.thread_id, index]))
  const threads = [...visible.map((session) => summary(session, entryOf(session))), ...degraded.map(degradedSummary)]
    .sort(
      (left, right) =>
        (order.get(left.thread_id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.thread_id) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((thread) => threadRow(thread))
  return { kind: "ok", threads, scope: allScope === true ? "all" : "workspace" }
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
  signal?: AbortSignal,
): Promise<ThreadToolResult> {
  const located = await locateControl(options, current, value.thread, value.all_scope, callerId)
  if (located.kind === "error") return located.result
  if (located.kind === "not_live") return readDegraded(options, current, located.thread_id, value)
  return readLive(located.control, value, signal)
}

/** `thread_read` of a live thread through its control: the optional wait, then one bounded slice. */
async function readLive(
  control: SessionControl,
  value: ThreadReadInput,
  signal?: AbortSignal,
): Promise<ThreadToolResult> {
  let wait: ThreadWaitOutcome | undefined
  if (value.wait_ms !== undefined) {
    try {
      wait = await control.waitSettled(value.wait_ms, signal)
    } catch (error) {
      const refusal = controlRefusalOf(error)
      if (refusal === undefined) throw error
      return { kind: "error", error: refusal }
    }
  }
  const result =
    (await pagedReadResult(control, value)) ??
    liveReadResult(control.thread_id, control.title, await control.getMessages(), value)
  return result.kind === "ok"
    ? { ...result, ...controlIdentity(control), ...(wait === undefined ? {} : { wait }) }
    : result
}

/**
 * The slice its holder pages (#14047), or undefined when the read takes the whole transcript: the leg pages nothing,
 * the holder answers `unsupported`, or the cursor came from the whole-transcript reader. An entry cursor on a leg that
 * no longer pages is stale.
 */
async function pagedReadResult(control: SessionControl, value: ThreadReadInput): Promise<ThreadToolResult | undefined> {
  const entryCursor = value.cursor !== undefined && isEntryCursor(value.cursor)
  if (value.cursor !== undefined && !entryCursor) return undefined
  const page = await control.readEntryPage?.({
    ...(value.max_bytes === undefined ? {} : { max_bytes: value.max_bytes }),
    ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
  })
  if (page === undefined || page.kind === "unsupported") {
    if (!entryCursor) return undefined
    return staleEntryCursor()
  }
  if (page.kind === "error") return page
  return {
    kind: "ok",
    thread: control.thread_id,
    link: threadLink(control.thread_id, control.title),
    items: liveItems(page.messages),
    truncated: page.truncated,
    ...(page.next_cursor === null ? {} : { next_cursor: page.next_cursor }),
    source: "live_host",
  }
}

/** A live slice's messages as items, numbered from 1, on every leg. */
function liveItems(messages: readonly ThreadTranscriptEntry[]) {
  return messages.map((item, index) => ({
    seq: index + 1,
    role: transcriptRole(item.role),
    content: JSON.stringify(item.content ?? item),
  }))
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
    thread: threadId,
    link: threadLink(threadId, title),
    items: liveItems(live.items),
    truncated: live.truncated,
    ...(live.next_cursor === null ? {} : { next_cursor: live.next_cursor }),
    source: live.source,
  }
}

/**
 * A thread with no live owner is read from its session file, the one a send to it finds (a closed thread, or one whose
 * endpoint is dead, which adds the endpoint's failure as `error_note`). Only a thread with no file here is
 * `not_resumable`.
 */
function readDegraded(
  options: ThreadToolSurfaceOptions,
  current: ThreadHostView,
  threadId: string,
  value: ThreadReadInput,
): ThreadToolResult {
  const entry = sendAddressBook(options, current, threadId, true).find((candidate) => candidate.thread_id === threadId)
  if (entry === undefined || entry.session_path === null)
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
    thread: threadId,
    link: threadLink(threadId, entry.title),
    items,
    truncated: durable.truncated,
    ...(durable.next_cursor === null ? {} : { next_cursor: durable.next_cursor }),
    source: durable.source,
    source_incomplete: durable.source_incomplete,
    ...(entry.error_note === undefined ? {} : { error_note: entry.error_note }),
  }
}
