import type { PluginInput } from "@opencode-ai/plugin"
import { clearSessionAgent, setSessionAgent, subagentSessions, syncSubagentSessions } from "../../features/claude-code-session-state"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../hooks/shared/prompt-async-gate"
import { getAgentToolRestrictions, isAmbiguousPostDispatchPromptFailure, log } from "../../shared"
import { getAgentDisplayName, stripAgentListSortPrefix } from "../../shared/agent-display-names"
import {
  clearDelegatedChildSessionBootstrap,
  registerDelegatedChildSessionBootstrap,
} from "../../shared/delegated-child-session-bootstrap"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { DelegatedModelConfig } from "../../shared/model-resolution-types"
import { applySessionPromptParams } from "../../shared/session-prompt-params-helpers"
import { deleteSessionTools, setSessionTools } from "../../shared/session-tools-store"
import { waitForCompletion } from "./completion-poller"
import { processMessages } from "./message-processor"
import { createOrGetSession } from "./session-creator"
import type { CallOmoAgentArgs } from "./types"

type SessionWithPrompt = {
  prompt: (opts: { path: { id: string }; body: Record<string, unknown> }) => Promise<unknown>
}

function hasPrompt(session: PluginInput["client"]["session"]): session is PluginInput["client"]["session"] & SessionWithPrompt {
  return "prompt" in session && typeof session.prompt === "function"
}

type ExecuteSyncDeps = {
  createOrGetSession: typeof createOrGetSession
  waitForCompletion: typeof waitForCompletion
  processMessages: typeof processMessages
  setSessionFallbackChain: (sessionID: string, fallbackChain: FallbackEntry[] | undefined) => void
  clearSessionFallbackChain: (sessionID: string) => void
}

type SpawnReservation = {
  commit: () => number
  rollback: () => void
}

const defaultDeps: ExecuteSyncDeps = {
  createOrGetSession,
  waitForCompletion,
  processMessages,
  setSessionFallbackChain: () => {},
  clearSessionFallbackChain: () => {},
}

function buildPromptGenerationParams(model: DelegatedModelConfig | undefined): Record<string, unknown> {
  if (!model) {
    return {}
  }

  const promptOptions: Record<string, unknown> = {
    ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
    ...(model.thinking ? { thinking: model.thinking } : {}),
  }

  return {
    ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    ...(model.top_p !== undefined ? { topP: model.top_p } : {}),
    ...(model.maxTokens !== undefined ? { maxOutputTokens: model.maxTokens } : {}),
    ...(Object.keys(promptOptions).length > 0 ? { options: promptOptions } : {}),
  }
}

function buildSyncPromptTools(agent: string): Record<string, boolean> {
  return {
    ...getAgentToolRestrictions(agent),
    task: false,
    question: false,
  }
}

export async function executeSync(
  args: CallOmoAgentArgs,
  toolContext: {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void | Promise<void>
  },
  ctx: PluginInput,
  deps: ExecuteSyncDeps = defaultDeps,
  fallbackChain?: FallbackEntry[],
  spawnReservation?: SpawnReservation,
  model?: DelegatedModelConfig,
): Promise<string> {
  let sessionID: string | undefined
  let createdSessionForExecution = false
  let appliedFallbackChain = false

  try {
    const session = await deps.createOrGetSession(args, toolContext, ctx, model)
    sessionID = session.sessionID
    createdSessionForExecution = session.isNew
    subagentSessions.add(sessionID)
    syncSubagentSessions.add(sessionID)

    if (session.isNew) {
      spawnReservation?.commit()
    }

    if (fallbackChain && fallbackChain.length > 0) {
      deps.setSessionFallbackChain(sessionID, fallbackChain)
      appliedFallbackChain = true
    }

    applySessionPromptParams(sessionID, model)

    await Promise.resolve(
      toolContext.metadata?.({
        title: args.description,
        metadata: { sessionId: sessionID },
      })
    )

    log(`[call_omo_agent] Sending prompt to session ${sessionID}`)
    log(`[call_omo_agent] Prompt text:`, args.prompt.substring(0, 100))
    const normalizedSubagentType = stripAgentListSortPrefix(args.subagent_type)
    const promptAgent = getAgentDisplayName(normalizedSubagentType)
    const promptTools = buildSyncPromptTools(normalizedSubagentType)
    setSessionAgent(sessionID, promptAgent)
    setSessionTools(sessionID, promptTools)
    registerDelegatedChildSessionBootstrap({
      sessionID,
      promptText: args.prompt,
      fallbackChain,
      tools: promptTools,
    })

    try {
      if (!hasPrompt(ctx.client.session)) {
        return `Error: Failed to send prompt: prompt is not available on this OpenCode client.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
      }

      const promptResult = await dispatchInternalPrompt({
        mode: "sync",
        client: ctx.client,
        sessionID,
        source: "call-omo-agent:sync",
        settleMs: 0,
        queueBehavior: "defer",
        input: {
          path: { id: sessionID },
          body: {
            agent: promptAgent,
            tools: promptTools,
            parts: [{ type: "text", text: args.prompt }],
            ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
            ...(model?.variant ? { variant: model.variant } : {}),
            ...buildPromptGenerationParams(model),
          },
        },
      })
      const promptMayHaveBeenAccepted = promptResult.status === "failed"
        && isAmbiguousPostDispatchPromptFailure(promptResult)
      if (promptResult.status === "failed") {
        if (promptMayHaveBeenAccepted) {
          log("[call_omo_agent] Prompt returned an ambiguous error after dispatch; waiting for completion", {
            sessionID,
            error: promptResult.error instanceof Error ? promptResult.error.message : String(promptResult.error),
          })
        } else {
          throw promptResult.error
        }
      }
      if (!promptMayHaveBeenAccepted && !isInternalPromptDispatchAccepted(promptResult)) {
        throw new Error(`prompt skipped by gate: ${promptResult.status}`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log(`[call_omo_agent] Prompt error:`, errorMessage)
      if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
        return `Error: Agent "${normalizedSubagentType}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
      }
      return `Error: Failed to send prompt: ${errorMessage}\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
    }

    await deps.waitForCompletion(sessionID, toolContext, ctx)

    const responseText = await deps.processMessages(sessionID, ctx)

    return responseText + "\n\n" + ["<task_metadata>", `session_id: ${sessionID}`, "</task_metadata>"].join("\n")
  } catch (error) {
    spawnReservation?.rollback()
    throw error
  } finally {
    if (sessionID && appliedFallbackChain) {
      deps.clearSessionFallbackChain(sessionID)
    }

    if (sessionID) {
      clearDelegatedChildSessionBootstrap(sessionID)
    }

    if (sessionID && createdSessionForExecution) {
      subagentSessions.delete(sessionID)
      syncSubagentSessions.delete(sessionID)
      deleteSessionTools(sessionID)
      clearSessionAgent(sessionID)
    }
  }
}
