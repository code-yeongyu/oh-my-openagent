import type { PluginInput } from "@opencode-ai/plugin"
import { createAtlasEventHandler } from "./event-handler"
import { AtlasLifecycleStore } from "./atlas-lifecycle-store"
import { createToolExecuteAfterHandler } from "./tool-execute-after"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { AtlasHookOptions, SessionState } from "./types"

export function createAtlasHook(ctx: PluginInput, options?: AtlasHookOptions) {
  const lifecycle = new AtlasLifecycleStore()
  const autoCommit = options?.autoCommit ?? true

  function getState(sessionID: string): SessionState {
    return lifecycle.getOrCreateState(sessionID)
  }

  return {
    handler: createAtlasEventHandler({ ctx, options, sessions: lifecycle.sessions, getState, cleanupSession: (sessionID) => lifecycle.cleanupSession(sessionID) }),
    "tool.execute.before": createToolExecuteBeforeHandler({
      ctx,
      pendingFilePaths: lifecycle.pendingFilePaths,
      pendingTaskRefs: lifecycle.pendingTaskRefs,
      pendingPlanSnapshots: lifecycle.pendingPlanSnapshots,
      trackFileCall: (callID, sessionID, filePath) => lifecycle.trackFileCall(callID, sessionID, filePath),
      trackTaskCall: (callID, sessionID, task) => lifecycle.trackTaskCall(callID, sessionID, task),
      trackPlanSnapshot: (callID, snapshot) => lifecycle.trackPlanSnapshot(callID, snapshot),
      isCallerOrchestrator: options?.isCallerOrchestrator,
    }),
    "tool.execute.after": createToolExecuteAfterHandler({
      ctx,
      pendingFilePaths: lifecycle.pendingFilePaths,
      pendingTaskRefs: lifecycle.pendingTaskRefs,
      pendingPlanSnapshots: lifecycle.pendingPlanSnapshots,
      autoCommit,
      getState,
      isCallerOrchestrator: options?.isCallerOrchestrator,
    }),
    dispose: () => lifecycle.dispose(),
  }
}
