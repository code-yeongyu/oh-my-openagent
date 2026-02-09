import type { PluginInput } from "@opencode-ai/plugin"
import { createAtlasEventHandler } from "./event-handler"
import { createToolExecuteAfterHandler } from "./tool-execute-after"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { AtlasHookOptions, SessionState } from "./types"

export function createAtlasHook(ctx: PluginInput, options?: AtlasHookOptions) {
  const sessions = new Map<string, SessionState>()
  const pendingFilePaths = new Map<string, string>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = { promptFailureCount: 0 }
      sessions.set(sessionID, state)
    }
    return state
  }

  return {
    handler: createAtlasEventHandler({ ctx, options, sessions, getState }),
    "tool.execute.before": createToolExecuteBeforeHandler({ pendingFilePaths }),
    "tool.execute.after": createToolExecuteAfterHandler({ ctx, pendingFilePaths }),
  }
}
