import { log } from "../../shared/logger"
import { writeSuggestion } from "./suggestion-writer"

const HOOK_NAME = "task-reflection-suggester"
const TOOL_CALL_MIN = 5

interface SessionState {
  toolCallCount: number
  hadErrors: boolean
  skillWasUsed: boolean
  suggested: boolean
}

export function createTaskReflectionSuggesterHook() {
  const sessions = new Map<string, SessionState>()

  function getOrCreate(sessionID: string): SessionState {
    if (!sessions.has(sessionID)) {
      sessions.set(sessionID, {
        toolCallCount: 0,
        hadErrors: false,
        skillWasUsed: false,
        suggested: false,
      })
    }
    return sessions.get(sessionID)!
  }

  return {
    subscriptions: ["tool.execute.after", "event"],

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
    ): Promise<void> => {
      const state = getOrCreate(input.sessionID)
      state.toolCallCount++
      if (input.tool.toLowerCase() === "skill") {
        state.skillWasUsed = true
      }
    },

    event: async (
      input: { event: { type: string; properties?: unknown } },
    ): Promise<void> => {
      const props = input.event.properties as Record<string, unknown> | undefined

      if (input.event.type === "session.error") {
        const sessionID = props?.sessionID as string | undefined
        if (sessionID) getOrCreate(sessionID).hadErrors = true
        return
      }

      if (input.event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        const state = sessions.get(sessionID)
        if (!state || state.suggested || state.skillWasUsed) return
        if (state.toolCallCount < TOOL_CALL_MIN) return

        state.suggested = true
        log(`[${HOOK_NAME}] Suggesting skill creation`, {
          sessionID,
          toolCallCount: state.toolCallCount,
          hadErrors: state.hadErrors,
        })
        writeSuggestion({ sessionID, toolCallCount: state.toolCallCount, hadErrors: state.hadErrors })
        return
      }

      if (input.event.type === "session.deleted") {
        const sessionID = (props?.info as { id?: string } | undefined)?.id
        if (sessionID) sessions.delete(sessionID)
      }
    },
  }
}
