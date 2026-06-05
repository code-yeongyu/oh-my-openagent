import { setSessionAgent, subagentSessions, syncSubagentSessions } from "../../features/claude-code-session-state"
import {
  clearDelegatedChildSessionBootstrap,
  registerDelegatedChildSessionBootstrap,
} from "../../shared/delegated-child-session-bootstrap"
import { log } from "../../shared/logger"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import type { ExecutorContext, ParentContext } from "./executor-types"
import { buildTaskPrompt } from "./prompt-builder"
import { buildSyncPromptTools } from "./sync-prompt-sender"
import type { DelegateTaskArgs } from "./types"

export async function registerSyncSessionSideEffects(input: {
  readonly args: DelegateTaskArgs
  readonly executorCtx: ExecutorContext
  readonly sessionID: string
  readonly parentContext: ParentContext
  readonly agentToUse: string
  readonly fallbackChain: import("../../shared/model-requirements").FallbackEntry[] | undefined
  readonly systemContent: string | undefined
}): Promise<void> {
  subagentSessions.add(input.sessionID)
  syncSubagentSessions.add(input.sessionID)
  setSessionAgent(input.sessionID, input.agentToUse)
  registerDelegatedChildSessionBootstrap({
    sessionID: input.sessionID,
    promptText: buildTaskPrompt(input.args.prompt, input.agentToUse, input.executorCtx.sisyphusAgentConfig?.tdd),
    fallbackChain: input.fallbackChain,
    category: input.args.category,
    system: input.systemContent,
    tools: buildSyncPromptTools(input.agentToUse),
    modelFallbackControllerAccessor: input.executorCtx.modelFallbackControllerAccessor,
  })

  if (input.executorCtx.onSyncSessionCreated) {
    log("[task] Invoking onSyncSessionCreated callback", {
      sessionID: input.sessionID,
      parentID: input.parentContext.sessionID,
    })
    try {
      await input.executorCtx.onSyncSessionCreated({
        sessionID: input.sessionID,
        parentID: input.parentContext.sessionID,
        title: input.args.description,
      })
    } catch (error) {
      const message = error instanceof Error ? String(error) : String(error)
      log("[task] onSyncSessionCreated callback failed", { error: message })
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
}

export function cleanupSyncSessionSideEffects(
  sessionID: string,
  executorCtx: Pick<ExecutorContext, "modelFallbackControllerAccessor">
): void {
  subagentSessions.delete(sessionID)
  syncSubagentSessions.delete(sessionID)
  clearDelegatedChildSessionBootstrap(sessionID)
  executorCtx.modelFallbackControllerAccessor?.clearSessionFallbackChain(sessionID)
  SessionCategoryRegistry.remove(sessionID)
}
