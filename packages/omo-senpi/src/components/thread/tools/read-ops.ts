import { toThreadAddressEntries } from "../address-book"
import { workspaceDirectories, workspaceEntries } from "../addressing"
import type { ThreadReadInput, ThreadState, ThreadToolResult, ThreadWaitOutcome } from "../contracts"
import { listDiskSessions } from "../disk-list"
import { locateControl } from "../control/locate"
import { controlIdentity, controlRefusalOf, type SessionControl } from "../control/port"
import { isEntryCursor, staleEntryCursor } from "../paged-reader"
import { readTranscript, type ThreadTranscriptEntry } from "../reader"
import { threadLink } from "../thread-link"
import { addressBook, degradedSummary, failure, rowNamed, sendAddressBook, summary } from "./internals"
import { readItem } from "./read-item"
import { threadRow } from "./thread-row"
import { listedStates } from "./thread-state"
import type { ThreadHostSession, ThreadHostView, ThreadToolSurfaceOptions } from "./ports"

/**
 * `thread_list` over one host view. Default scope is the caller's workspace, the same test
 * thread_send applies before it delivers; the address book itself spans every workspace the host
 * knows. A session no engine holds is still a thread, listed `inactive` from its JSONL: one whose
 * endpoint stopped answering (with the endpoint's failure in error_note), and one whose session file
 * is in the scanned session directories (the caller's workspace, every workspace with `all_scope`;
 * the newest files only) after its engine closed it. `inactive_dropped` counts the threads of the files that listing did not
 * read, each inactive or archived (with `inactive_truncated`), when the filter shows either: a running or idle thread is
 * listed from its endpoint, never dropped. `states` filters the rows; the default lists every state but archived.
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
      ? { sessions: [], unread: [] }
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
  const threads = [
    ...visible.map((session) => {
      const entry = entryOf(session)
      return rowNamed(summary(session, entry), entry?.name ?? session.name, entry?.title)
    }),
    ...inactive.map((entry) => rowNamed(degradedSummary(entry), entry.name, entry.title)),
  ]
    .filter((thread) => shown.has(thread.state))
    .sort(
      (left, right) =>
        (order.get(left.thread_id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(right.thread_id) ?? Number.MAX_SAFE_INTEGER),
    )
    .map((thread) => threadRow(thread))
  const rowIds = new Set(threads.map((thread) => thread.thread))
  // An unread file's thread is inactive or archived (only its file knows which), so a filter showing either is partial.
  const dropped =
    shown.has("inactive") || shown.has("archived")
      ? scanned.unread.filter((id) => !listed.has(id) && !rowIds.has(id)).length
      : 0
  // An endpoint that did not answer (timed out, an auth or protocol failure) may hold threads this listing reads from their
  // files as inactive; one known dead (its socket gone or refusing) holds none, so only the former makes it partial (#14308).
  const unanswered = current.hosts.filter(
    (host) => (host.error !== undefined || host.alive === false) && host.reason !== "dead",
  ).length
  return {
    kind: "ok",
    threads,
    scope: allScope === true ? "all" : "workspace",
    ...(dropped > 0 ? { inactive_truncated: true as const, inactive_dropped: dropped } : {}),
    ...(unanswered > 0 ? { listing: "incomplete" as const, unanswered_endpoints: unanswered } : {}),
  }
}

/** Names each listed thread's undelivered messages from this device's gateway store (#14428): how many, where, since when. */
export async function withBacklog(
  store: Pick<ThreadToolSurfaceOptions["store"], "backlogs">,
  listed: ThreadToolResult,
): Promise<ThreadToolResult> {
  if (listed.kind !== "ok" || !("threads" in listed) || listed.threads.length === 0) return listed
  let backlogs: Awaited<ReturnType<typeof store.backlogs>>
  try {
    backlogs = await store.backlogs(listed.threads.map((thread) => thread.thread))
  } catch (error) {
    // The backlog is an optional detail: a store that cannot be read (a newer schema, a worker that failed to start) never
    // costs the listing, which is how a stuck gateway is diagnosed, and the listing names why the backlog is missing.
    return { ...listed, backlog_error: error instanceof Error ? error.message : String(error) }
  }
  return {
    ...listed,
    threads: listed.threads.map((thread) => {
      const found = backlogs[thread.thread]
      if (found === undefined || found.oldest_at === null) return thread
      return {
        ...thread,
        backlog: {
          held: found.held,
          held_by_session: found.held_by_session,
          waiting_in_gateway: found.waiting_in_gateway,
          oldest_at: new Date(found.oldest_at).toISOString(),
        },
      }
    }),
  }
}

/**
 * A first read takes the newest entries of the trailing window that fit the budget; a read that carries a cursor
 * pages from it (a first read's cursor names the older part of that window). Tail mode ignores the cursor, so following
 * next_cursor in tail mode returned the same slice again.
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
  return messages.map(readItem)
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
  const items = messages.map(readItem)
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
