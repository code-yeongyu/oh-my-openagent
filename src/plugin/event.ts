import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import {
  clearSessionAgent,
  getMainSessionID,
  getSessionAgent,
  subagentSessions,
  syncSubagentSessions,
  setMainSession,
  updateSessionAgent,
} from "../features/claude-code-session-state"
import { resetMessageCursor } from "../shared"
import { lspManager } from "../tools"
import { shouldRetryError } from "../shared/model-error-classifier"
import { clearPendingModelFallback, clearSessionFallbackChain, setPendingModelFallback } from "../hooks/model-fallback/hook"
import { clearSessionModel, setSessionModel } from "../shared/session-model-state"

import type { CreatedHooks } from "../create-hooks"
import type { Managers } from "../create-managers"
import { normalizeSessionStatusToIdle } from "./session-status-normalizer"
import { pruneRecentSyntheticIdles } from "./recent-synthetic-idles"

type FirstMessageVariantGate = {
  markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void
  clear: (sessionID: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeFallbackModelID(modelID: string): string {
  return modelID
    .replace(/-thinking$/i, "")
    .replace(/-max$/i, "")
    .replace(/-high$/i, "")
}

function extractErrorName(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.name === "string") return error.name
  if (error instanceof Error) return error.name
  return undefined
}

function extractErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message

  if (isRecord(error)) {
    const candidates: unknown[] = [
      error,
      error.data,
      error.error,
      isRecord(error.data) ? error.data.error : undefined,
      error.cause,
    ]

    for (const candidate of candidates) {
      if (isRecord(candidate) && typeof candidate.message === "string" && candidate.message.length > 0) {
        return candidate.message
      }
    }
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function extractProviderModelFromErrorMessage(
  message: string,
): { providerID?: string; modelID?: string } {
  const lower = message.toLowerCase()

  const providerModel = lower.match(/model\s+not\s+found:\s*([a-z0-9_-]+)\s*\/\s*([a-z0-9._-]+)/i)
  if (providerModel) {
    return {
      providerID: providerModel[1],
      modelID: providerModel[2],
    }
  }

  const modelOnly = lower.match(/unknown\s+provider\s+for\s+model\s+([a-z0-9._-]+)/i)
  if (modelOnly) {
    return {
      modelID: modelOnly[1],
    }
  }

  return {}
}
type EventInput = Parameters<
  NonNullable<NonNullable<CreatedHooks["writeExistingFileGuard"]>["event"]>
>[0]
export function createEventHandler(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  firstMessageVariantGate: FirstMessageVariantGate
  managers: Managers
  hooks: CreatedHooks
}): (input: EventInput) => Promise<void> {
  const { ctx, firstMessageVariantGate, managers, hooks } = args

  // Avoid triggering multiple abort+continue cycles for the same failing assistant message.
  const lastHandledModelErrorMessageID = new Map<string, string>()
  const lastHandledRetryStatusKey = new Map<string, string>()
  const lastKnownModelBySession = new Map<string, { providerID: string; modelID: string }>()

  const dispatchToHooks = async (input: EventInput): Promise<void> => {
    await Promise.resolve(hooks.autoUpdateChecker?.event?.(input))
    await Promise.resolve(hooks.claudeCodeHooks?.event?.(input))
    await Promise.resolve(hooks.backgroundNotificationHook?.event?.(input))
    await Promise.resolve(hooks.sessionNotification?.(input))
    await Promise.resolve(hooks.todoContinuationEnforcer?.handler?.(input))
    await Promise.resolve(hooks.unstableAgentBabysitter?.event?.(input))
    await Promise.resolve(hooks.contextWindowMonitor?.event?.(input))
    await Promise.resolve(hooks.directoryAgentsInjector?.event?.(input))
    await Promise.resolve(hooks.directoryReadmeInjector?.event?.(input))
    await Promise.resolve(hooks.rulesInjector?.event?.(input))
    await Promise.resolve(hooks.thinkMode?.event?.(input))
    await Promise.resolve(hooks.anthropicContextWindowLimitRecovery?.event?.(input))
    await Promise.resolve(hooks.runtimeFallback?.event?.(input))
    await Promise.resolve(hooks.agentUsageReminder?.event?.(input))
    await Promise.resolve(hooks.categorySkillReminder?.event?.(input))
    await Promise.resolve(hooks.interactiveBashSession?.event?.(input as EventInput))
    await Promise.resolve(hooks.ralphLoop?.event?.(input))
    await Promise.resolve(hooks.stopContinuationGuard?.event?.(input))
    await Promise.resolve(hooks.compactionTodoPreserver?.event?.(input))
    await Promise.resolve(hooks.atlasHook?.handler?.(input))
  }

  const recentSyntheticIdles = new Map<string, number>()
  const recentRealIdles = new Map<string, number>()
  const DEDUP_WINDOW_MS = 500

  const shouldAutoRetrySession = (sessionID: string): boolean => {
    if (syncSubagentSessions.has(sessionID)) return true
    const mainSessionID = getMainSessionID()
    if (mainSessionID) return sessionID === mainSessionID
    // Headless runs (or resumed sessions) may not emit session.created, so mainSessionID can be unset.
    // In that case, treat any non-subagent session as the "main" interactive session.
    return !subagentSessions.has(sessionID)
  }

  return async (input): Promise<void> => {
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: Date.now(),
      dedupWindowMs: DEDUP_WINDOW_MS,
    })

    if (input.event.type === "session.idle") {
      const sessionID = (input.event.properties as Record<string, unknown> | undefined)?.sessionID as string | undefined
      if (sessionID) {
        const emittedAt = recentSyntheticIdles.get(sessionID)
        if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
          recentSyntheticIdles.delete(sessionID)
          return
        }
        recentRealIdles.set(sessionID, Date.now())
      }
    }

    await dispatchToHooks(input)

    const syntheticIdle = normalizeSessionStatusToIdle(input)
    if (syntheticIdle) {
      const sessionID = (syntheticIdle.event.properties as Record<string, unknown>)?.sessionID as string
      const emittedAt = recentRealIdles.get(sessionID)
      if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
        recentRealIdles.delete(sessionID)
        return
      }
      recentSyntheticIdles.set(sessionID, Date.now())
      await dispatchToHooks(syntheticIdle as EventInput)
    }

    const { event } = input
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.created") {
      const sessionInfo = props?.info as
        | { id?: string; title?: string; parentID?: string }
        | undefined

      if (!sessionInfo?.parentID) {
        setMainSession(sessionInfo?.id)
      }

      firstMessageVariantGate.markSessionCreated(sessionInfo)

      await managers.tmuxSessionManager.onSessionCreated(
        event as {
          type: string
          properties?: {
            info?: { id?: string; parentID?: string; title?: string }
          }
        },
      )
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id === getMainSessionID()) {
        setMainSession(undefined)
      }

      if (sessionInfo?.id) {
        clearSessionAgent(sessionInfo.id)
        lastHandledModelErrorMessageID.delete(sessionInfo.id)
        lastHandledRetryStatusKey.delete(sessionInfo.id)
        lastKnownModelBySession.delete(sessionInfo.id)
        clearPendingModelFallback(sessionInfo.id)
        clearSessionFallbackChain(sessionInfo.id)
        resetMessageCursor(sessionInfo.id)
        firstMessageVariantGate.clear(sessionInfo.id)
        clearSessionModel(sessionInfo.id)
        syncSubagentSessions.delete(sessionInfo.id)
        await managers.skillMcpManager.disconnectSession(sessionInfo.id)
        await lspManager.cleanupTempDirectoryClients()
        await managers.tmuxSessionManager.onSessionDeleted({
          sessionID: sessionInfo.id,
        })
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const agent = info?.agent as string | undefined
      const role = info?.role as string | undefined
      if (sessionID && role === "user") {
        if (agent) {
          updateSessionAgent(sessionID, agent)
        }
        const providerID = info?.providerID as string | undefined
        const modelID = info?.modelID as string | undefined
        if (providerID && modelID) {
          lastKnownModelBySession.set(sessionID, { providerID, modelID })
          setSessionModel(sessionID, { providerID, modelID })
        }
      }

      // Model fallback: in practice, API/model failures often surface as assistant message errors.
      // session.error events are not guaranteed for all providers, so we also observe message.updated.
      if (sessionID && role === "assistant") {
        const assistantMessageID = info?.id as string | undefined
        const assistantError = info?.error
        if (assistantMessageID && assistantError) {
          const lastHandled = lastHandledModelErrorMessageID.get(sessionID)
          if (lastHandled === assistantMessageID) {
            return
          }

          const errorName = extractErrorName(assistantError)
          const errorMessage = extractErrorMessage(assistantError)
          const errorInfo = { name: errorName, message: errorMessage }

          if (shouldRetryError(errorInfo)) {
            // Prefer the agent/model/provider from the assistant message payload.
            let agentName = agent ?? getSessionAgent(sessionID)
            if (!agentName && sessionID === getMainSessionID()) {
              if (errorMessage.includes("claude-opus") || errorMessage.includes("opus")) {
                agentName = "sisyphus"
              } else if (errorMessage.includes("gpt-5")) {
                agentName = "hephaestus"
              } else {
                agentName = "sisyphus"
              }
            }

            if (agentName) {
              const currentProvider = (info?.providerID as string | undefined) ?? "opencode"
              const rawModel = (info?.modelID as string | undefined) ?? "claude-opus-4-6"
              const currentModel = normalizeFallbackModelID(rawModel)

              const setFallback = setPendingModelFallback(
                sessionID,
                agentName,
                currentProvider,
                currentModel,
              )

              if (setFallback && shouldAutoRetrySession(sessionID) && !hooks.stopContinuationGuard?.isStopped(sessionID)) {
                lastHandledModelErrorMessageID.set(sessionID, assistantMessageID)

                await ctx.client.session.abort({ path: { id: sessionID } }).catch(() => {})
                await ctx.client.session
                  .prompt({
                    path: { id: sessionID },
                    body: { parts: [{ type: "text", text: "continue" }] },
                    query: { directory: ctx.directory },
                  })
                  .catch(() => {})
              }
            }
          }
        }
      }
    }

    if (event.type === "session.status") {
      const sessionID = props?.sessionID as string | undefined
      const status = props?.status as
        | { type?: string; attempt?: number; message?: string; next?: number }
        | undefined

      if (sessionID && status?.type === "retry") {
        const retryMessage = typeof status.message === "string" ? status.message : ""
        const retryKey = `${status.attempt ?? "?"}:${status.next ?? "?"}:${retryMessage}`
        if (lastHandledRetryStatusKey.get(sessionID) === retryKey) {
          return
        }
        lastHandledRetryStatusKey.set(sessionID, retryKey)

        const errorInfo = { name: undefined, message: retryMessage }
        if (shouldRetryError(errorInfo)) {
          let agentName = getSessionAgent(sessionID)
          if (!agentName && sessionID === getMainSessionID()) {
            if (retryMessage.includes("claude-opus") || retryMessage.includes("opus")) {
              agentName = "sisyphus"
            } else if (retryMessage.includes("gpt-5")) {
              agentName = "hephaestus"
            } else {
              agentName = "sisyphus"
            }
          }

          if (agentName) {
            const parsed = extractProviderModelFromErrorMessage(retryMessage)
            const lastKnown = lastKnownModelBySession.get(sessionID)
            const currentProvider = parsed.providerID ?? lastKnown?.providerID ?? "opencode"
            let currentModel = parsed.modelID ?? lastKnown?.modelID ?? "claude-opus-4-6"
            currentModel = normalizeFallbackModelID(currentModel)

            const setFallback = setPendingModelFallback(
              sessionID,
              agentName,
              currentProvider,
              currentModel,
            )

            if (setFallback && shouldAutoRetrySession(sessionID) && !hooks.stopContinuationGuard?.isStopped(sessionID)) {
              await ctx.client.session.abort({ path: { id: sessionID } }).catch(() => {})
              await ctx.client.session
                .prompt({
                  path: { id: sessionID },
                  body: { parts: [{ type: "text", text: "continue" }] },
                  query: { directory: ctx.directory },
                })
                .catch(() => {})
            }
          }
        }
      }
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      const error = props?.error

      const errorName = extractErrorName(error)
      const errorMessage = extractErrorMessage(error)
      const errorInfo = { name: errorName, message: errorMessage }

      // First, try session recovery for internal errors (thinking blocks, tool results, etc.)
      if (hooks.sessionRecovery?.isRecoverableError(error)) {
        const messageInfo = {
          id: props?.messageID as string | undefined,
          role: "assistant" as const,
          sessionID,
          error,
        }
        const recovered = await hooks.sessionRecovery.handleSessionRecovery(messageInfo)

        if (
          recovered &&
          sessionID &&
          sessionID === getMainSessionID() &&
          !hooks.stopContinuationGuard?.isStopped(sessionID)
        ) {
          await ctx.client.session
            .prompt({
              path: { id: sessionID },
              body: { parts: [{ type: "text", text: "continue" }] },
              query: { directory: ctx.directory },
            })
            .catch(() => {})
        }
      } 
      // Second, try model fallback for model errors (rate limit, quota, provider issues, etc.)
      else if (sessionID && shouldRetryError(errorInfo)) {
        // Get the current agent for this session, or default to "sisyphus" for main sessions
        let agentName = getSessionAgent(sessionID)
        
        // For main sessions, if no agent is set, try to infer from the error or default to sisyphus
        if (!agentName && sessionID === getMainSessionID()) {
          // Try to infer agent from model in error message
          if (errorMessage.includes("claude-opus") || errorMessage.includes("opus")) {
            agentName = "sisyphus"
          } else if (errorMessage.includes("gpt-5")) {
            agentName = "hephaestus"
          } else {
            // Default to sisyphus for main session errors
            agentName = "sisyphus"
          }
        }
        
        if (agentName) {
          const parsed = extractProviderModelFromErrorMessage(errorMessage)
          const currentProvider = props?.providerID as string || parsed.providerID || "opencode"
          let currentModel = props?.modelID as string || parsed.modelID || "claude-opus-4-6"
          currentModel = normalizeFallbackModelID(currentModel)

          // Try to set pending model fallback
          const setFallback = setPendingModelFallback(
            sessionID,
            agentName,
            currentProvider,
            currentModel,
          )
          
          if (setFallback && shouldAutoRetrySession(sessionID) && !hooks.stopContinuationGuard?.isStopped(sessionID)) {
            // Abort the current session and prompt with "continue" to trigger the fallback
            await ctx.client.session.abort({ path: { id: sessionID } }).catch(() => {})
            
            await ctx.client.session
              .prompt({
                path: { id: sessionID },
                body: { parts: [{ type: "text", text: "continue" }] },
                query: { directory: ctx.directory },
              })
              .catch(() => {})
          }
        }
      }
    }
  }
}
