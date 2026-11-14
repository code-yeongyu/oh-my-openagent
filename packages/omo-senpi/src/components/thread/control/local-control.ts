import { threadLink } from "../thread-link"
import { routingId, sessionPort, summary } from "../tools/internals"
import type { ThreadHostSession, ThreadToolSurfaceOptions } from "../tools/ports"
import type { ThreadIdentity } from "../contracts"
import { refuse, type SessionControl } from "./port"

const ARCHIVE_UNSUPPORTED = "unsupported:set_session_archived"

const THINKING_LEVEL_UNSUPPORTED = "thinking_level_unsupported:"

/** A thread this device's endpoint holds, controlled through the endpoint that listed it (`sessionPort`). */
export function createLocalControl(
  options: ThreadToolSurfaceOptions,
  session: ThreadHostSession,
  threadId: string,
  title: string,
  visible: () => readonly ThreadIdentity[],
): SessionControl {
  const port = sessionPort(options, session)
  const routing = routingId(session)
  return {
    thread_id: threadId,
    title,
    visible: async () => visible(),
    interrupt: async (turnId) => {
      const result = await port.interrupt(routing, turnId, threadId)
      return {
        interrupted: result.interrupted === true,
        ...(result.turnId === undefined ? {} : { turn_id: result.turnId }),
      }
    },
    close: async () => {
      if (session.endpoint_kind === "tui")
        throw refuse(
          "unsupported",
          `Thread ${threadId} belongs to an interactive terminal, which closes it when the terminal exits.`,
          "Close that terminal, or use thread_interrupt to stop its turn.",
          { command: "close_session" },
        )
      if (port.closeSession === undefined)
        throw refuse(
          "unsupported",
          `The host holding thread ${threadId} does not accept close requests.`,
          "Update omo on this device and restart its host.",
          { command: "close_session" },
        )
      return await port.closeSession(routing, threadId)
    },
    setName: (name) => port.setSessionName(routing, name, threadId),
    getAvailableModels: async () => ({ models: await port.getAvailableModels(routing), held: false }),
    setModel: async (provider, id) => {
      const selected = await port.setModel(routing, provider, id, threadId)
      return { provider: selected.provider, id: selected.id }
    },
    getAvailableThinkingLevels: () => port.getAvailableThinkingLevels(routing),
    setThinkingLevel: async (level, scope) => {
      try {
        await port.setThinkingLevel(routing, level, scope, threadId)
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
    running: async () => session.activity === "running" || (await port.getState(routing)).isStreaming === true,
    setArchived: async (archived) => {
      const unsupported = () =>
        refuse(
          "unsupported",
          `The engine holding thread ${threadId} does not know set_session_archived: it runs a senpi from before archived threads.`,
          "Update omo on this device and restart the session's host or terminal, then retry.",
          { command: "set_session_archived" },
        )
      if (port.setSessionArchived === undefined) throw unsupported()
      try {
        await port.setSessionArchived(routing, archived, threadId)
      } catch (error) {
        if (error instanceof Error && error.message === ARCHIVE_UNSUPPORTED) throw unsupported()
        throw error
      }
    },
    listed: async (archived) => ({
      ...summary({ ...session, archived }),
      name: title,
      link: threadLink(threadId, title),
    }),
  }
}
