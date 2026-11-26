// The tail reader ships in the thread client sidecar (lazy-ops), as the relay control's does: omo.js carries none of it.
import { readTailPage } from "../remote/lazy-ops"
import type { JsonObject } from "../remote/ports"
import type { EntryPagesPort } from "../remote/transcript-tail"
import { threadLink } from "../thread-link"
import { routingId, sessionPort, summary } from "../tools/internals"
import { threadRow } from "../tools/thread-row"
import { threadState } from "../tools/thread-state"
import type { ThreadHostSession, ThreadToolSurfaceOptions } from "../tools/ports"
import type { ThreadSummary } from "../contracts"
import { interruptOver } from "./interrupt"
import { refusal } from "../refusal-texts"
import { refuse, refuseWith, sessionModelState, SESSION_ONLY_THINKING_SCOPE, type SessionControl } from "./port"
import { waitForTurnEnd } from "./wait-settled"

const THINKING_LEVEL_UNSUPPORTED = "thinking_level_unsupported:"

const ARCHIVE_UNSUPPORTED = "unsupported:set_session_archived"

// The tail reader keys what it keeps by (port, device, session); this device's engine is one "device" per endpoint port.
const THIS_DEVICE = "local"
const UNKNOWN_COMMAND = /unknown[ _](?:command|type)|unsupported/i
const entryPorts = new WeakMap<object, EntryPagesPort>()

/**
 * This device's endpoint as the tail reader's port: one `get_entries` request per page. An engine that does not know the
 * command pages nothing for the port's life (`unsupported`); any other failure takes the whole transcript for that read
 * only (`invalid_request`), whose own request then answers the failure.
 */
function entryPagesOf(
  port: object,
  getEntries: (sessionId: string, page: Readonly<Record<string, unknown>>) => Promise<Record<string, unknown>>,
): EntryPagesPort {
  const known = entryPorts.get(port)
  if (known !== undefined) return known
  const made: EntryPagesPort = {
    sessionCommand: async (_device, sessionId, { type: _type, sessionId: _sent, ...page }) => {
      try {
        return { kind: "ok", response: { data: (await getEntries(sessionId, page)) as JsonObject } }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        return { kind: "refused", reason: UNKNOWN_COMMAND.test(text) ? "unsupported" : "invalid_request" }
      }
    },
  }
  entryPorts.set(port, made)
  return made
}

/** A thread this device's endpoint holds, controlled through the endpoint that listed it (`sessionPort`). */
export function createLocalControl(
  options: ThreadToolSurfaceOptions,
  session: ThreadHostSession,
  threadId: string,
  title: string,
  visible: () => readonly ThreadSummary[],
): SessionControl {
  const port = sessionPort(options, session)
  const routing = routingId(session)
  return {
    thread_id: threadId,
    title,
    visible: async () => visible(),
    interrupt: (turnId) => interruptOver((request) => port.interrupt(routing, request, threadId), turnId),
    close: async (closeOptions) => {
      // A terminal closes its own session only gracefully, and then exits by itself (omo#14313).
      if (session.endpoint_kind === "tui" && closeOptions?.graceful !== true)
        throw refuseWith(
          refusal(
            "control.close_terminal_graceful_only",
            { thread: threadId },
            { command: "close_session", retry_with: { graceful: true } },
          ),
        )
      if (port.closeSession === undefined)
        throw refuseWith(refusal("control.close_not_accepted", { thread: threadId }, { command: "close_session" }))
      return await port.closeSession(routing, threadId, closeOptions)
    },
    unload: async (unloadOptions) => {
      if (port.unloadSession === undefined)
        throw refuseWith(refusal("control.unload_unsupported", { thread: threadId }, { command: "unload_session" }))
      return await port.unloadSession(routing, threadId, unloadOptions)
    },
    setName: (name) => port.setSessionName(routing, name, threadId),
    getAvailableModels: async () => ({ models: await port.getAvailableModels(routing), held: false }),
    getModelState: async () => sessionModelState(await port.getState(routing, threadId)),
    setModel: async (provider, id) => {
      const selected = await port.setModel(routing, provider, id, threadId)
      return { provider: selected.provider, id: selected.id }
    },
    getAvailableThinkingLevels: () => port.getAvailableThinkingLevels(routing),
    setThinkingLevel: async (level) => {
      try {
        await port.setThinkingLevel(routing, level, SESSION_ONLY_THINKING_SCOPE, threadId)
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith(THINKING_LEVEL_UNSUPPORTED)) throw error
        throw refuse(
          "thinking_level_unsupported",
          error.message.slice(THINKING_LEVEL_UNSUPPORTED.length),
          "Choose a level from the supported list and retry.",
          { level },
        )
      }
    },
    getMessages: () => port.getMessages(routing),
    // The same entry pages and projector as a thread on another device (#14047), so a message has one id on both legs.
    ...(port.getEntries === undefined || options.remote?.loadProjector === undefined
      ? {}
      : {
          readEntryPage: async (read: Parameters<NonNullable<SessionControl["readEntryPage"]>>[0]) => {
            const project = await options.remote?.loadProjector?.().catch(() => undefined)
            if (project === undefined || port.getEntries === undefined) return { kind: "unsupported" as const }
            const page = await readTailPage(entryPagesOf(port, port.getEntries), THIS_DEVICE, routing, project, read)
            // This device's engine refusing a page takes the whole transcript for this read (get_messages).
            return page.kind === "failed" ? { kind: "unsupported" as const } : page
          },
        }),
    waitSettled: async (timeoutMs, signal) => {
      const { watchSession } = port
      if (watchSession === undefined)
        throw refuseWith(refusal("control.wait_unsupported", { thread: threadId }, { command: "subscribe_sessions" }))
      return await waitForTurnEnd(
        (handlers) => watchSession(routing, handlers, threadId),
        (reason) =>
          refuseWith(
            refusal("control.status_refused", { thread: threadId, reason }, { command: "subscribe_sessions", reason }),
          ),
        timeoutMs,
        signal,
      )
    },
    // The same rule thread_list applies: a queued or approval-waiting thread is mid-turn (tools/thread-state.ts).
    running: async () =>
      threadState({ archived: session.archived, held: true, activity: session.activity }) === "running" ||
      (await port.getState(routing)).isStreaming === true,
    setArchived: async (archived) => {
      const unsupported = () =>
        refuseWith(refusal("control.archive_unsupported", { thread: threadId }, { command: "set_session_archived" }))
      if (port.setSessionArchived === undefined) throw unsupported()
      try {
        await port.setSessionArchived(routing, archived, threadId)
      } catch (error) {
        if (error instanceof Error && error.message === ARCHIVE_UNSUPPORTED) throw unsupported()
        throw error
      }
    },
    listed: async (archived) =>
      threadRow({ ...summary({ ...session, archived }), name: title, link: threadLink(threadId, title) }),
  }
}
