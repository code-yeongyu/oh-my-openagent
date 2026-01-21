import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import { ProviderStatusManager } from "../../features/failover/status-manager"
import { ErrorDiagnoser } from "../../features/failover/diagnoser"
import { resolveModelChain } from "../../features/failover/resolver"
import { log } from "../../shared"
import type { ModelCacheState } from "../../plugin-state"

// Store both model key and agent name for context during events
const sessionContext = new Map<string, { modelKey: string; agent: string }>()
const toastedSessions = new Set<string>()
const pendingFailovers = new Set<string>()

export function createSmartFailoverHook(
  ctx: PluginInput,
  config: OhMyOpenCodeConfig,
  modelCacheState: ModelCacheState
) {
  const statusManager = ProviderStatusManager.getInstance()

  const findFallback = (agentName: string, currentModelKey: string, sessionID: string) => {
    const getModelConfig = (agent: string) => {
      // @ts-ignore
      return config.agents?.[agent]?.model
    }

    let modelConfig = getModelConfig(agentName) ?? config.model
    
    if (!modelConfig && agentName !== "Sisyphus") {
       modelConfig = getModelConfig("Sisyphus")
    }

    const chain = resolveModelChain(modelConfig as string | string[])
    if (!chain) return undefined

    return chain.fallbacks.find(m => {
      if (!statusManager.isAvailable(m)) return false

      const primaryLimit = modelCacheState.modelContextLimitsCache.get(currentModelKey)
      const fallbackLimit = modelCacheState.modelContextLimitsCache.get(m)

      if (primaryLimit && fallbackLimit && fallbackLimit < primaryLimit * 0.5) {
        log(`[SmartFailover] Skipping fallback ${m} due to small context window (${fallbackLimit} < ${primaryLimit})`, { sessionID })
        return false
      }
      return true
    })
  }

  const performFailover = async (sessionID: string, currentModelKey: string, agent: string, reason: string) => {
    if (pendingFailovers.has(sessionID)) return false
    pendingFailovers.add(sessionID)

    try {
      const fallback = findFallback(agent, currentModelKey, sessionID)
      
      if (fallback) {
        const [providerID, modelID] = fallback.split("/")
        if (providerID && modelID) {
          log(`[SmartFailover] Failover triggered: ${currentModelKey} -> ${fallback}. Reason: ${reason}`, { sessionID })
          
          if (!toastedSessions.has(sessionID)) {
            setTimeout(() => {
              ctx.client.tui.showToast({
                body: {
                  title: "Failover Active",
                  message: `⚠️ ${currentModelKey} unavailable. Switched to ${fallback}.`,
                  variant: "warning",
                  duration: 5000
                }
              }).catch(() => {})
            }, 1500)
            toastedSessions.add(sessionID)
          }

          sessionContext.set(sessionID, { modelKey: fallback, agent })

          await ctx.client.session.abort({ path: { id: sessionID } }).catch(() => {})

          let retryAttempt = 0
          const maxRetries = 5
          const checkAndPrompt = async () => {
            try {
              await ctx.client.session.prompt({
                path: { id: sessionID },
                body: {
                  model: { providerID, modelID },
                  agent,
                  parts: [{ type: "text", text: "System: Previous model failed. Please continue from exactly where you left off." }] 
                }
              })
              pendingFailovers.delete(sessionID)
            } catch (e: any) {
              if (e.message?.includes("busy") && retryAttempt < maxRetries) {
                retryAttempt++
                setTimeout(checkAndPrompt, 300)
              } else {
                log("[SmartFailover] Retry prompt failed", e)
                pendingFailovers.delete(sessionID)
              }
            }
          }
          
          setTimeout(checkAndPrompt, 500)
          return true
        }
      }
      pendingFailovers.delete(sessionID)
      return false
    } catch (e) {
      pendingFailovers.delete(sessionID)
      throw e
    }
  }

  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
      },
      output: {
        message: Record<string, unknown>
      }
    ) => {
      const currentModelKey = input.model 
        ? `${input.model.providerID}/${input.model.modelID}` 
        : undefined

      if (!currentModelKey) return

      const agentName = input.agent || "Sisyphus"
      sessionContext.set(input.sessionID, { modelKey: currentModelKey, agent: agentName })

      if (statusManager.isAvailable(currentModelKey)) {
        return
      }

      const fallback = findFallback(agentName, currentModelKey, input.sessionID)
      
      if (fallback) {
        const [providerID, modelID] = fallback.split("/")
        if (providerID && modelID && output.message) {
          output.message.model = { providerID, modelID }
          
          sessionContext.set(input.sessionID, { modelKey: fallback, agent: agentName })

          log(`[SmartFailover] Swapped ${currentModelKey} -> ${fallback}`, { sessionID: input.sessionID })
          
          if (!toastedSessions.has(input.sessionID)) {
            setTimeout(() => {
              ctx.client.tui.showToast({
                body: {
                  title: "Failover Active",
                  message: `⚠️ ${currentModelKey} unavailable. Switched to ${fallback}.`,
                  variant: "warning",
                  duration: 10000
                }
              }).catch(() => {})
            }, 1500)
            toastedSessions.add(input.sessionID)
          }
        }
      }
    },

    "event": async (input: { event: { type: string; properties?: unknown } }) => {
      if (input.event.type === "session.deleted") {
        const id = (input.event.properties as any)?.info?.id
        if (id) {
          sessionContext.delete(id)
          toastedSessions.delete(id)
          pendingFailovers.delete(id)
        }
      }

      if (input.event.type === "session.idle") {
        const props = input.event.properties as { sessionID?: string }
        const sessionID = props.sessionID
        if (sessionID) {
          const sessionCtx = sessionContext.get(sessionID)
          if (sessionCtx && statusManager.getStatus(sessionCtx.modelKey) === "PROBATION") {
            statusManager.markHealthy(sessionCtx.modelKey)
            log(`[SmartFailover] ${sessionCtx.modelKey} recovered from PROBATION`, { sessionID })
          }
        }
      }

      if (input.event.type === "session.status") {
        const props = input.event.properties as { status: { type: string; message?: string }, sessionID: string }
        if (props.status.type === "retry") {
           const sessionID = props.sessionID
           const sessionCtx = sessionContext.get(sessionID)
           
           if (sessionCtx && statusManager.getStatus(sessionCtx.modelKey) !== "COOLING") {
             const reason = props.status.message || "Retry loop detected"
             statusManager.markCooling(sessionCtx.modelKey, 300000, reason)
             await performFailover(sessionID, sessionCtx.modelKey, sessionCtx.agent, reason)
           }
        }
      }

      if (input.event.type === "session.error") {
        const props = input.event.properties as { error?: unknown; sessionID?: string }
        const sessionID = props.sessionID
        if (!sessionID) return

        if (String(props.error).includes("AbortError") || String(props.error).includes("Aborted")) return

        const sessionCtx = sessionContext.get(sessionID)
        if (!sessionCtx) return

        const result = ErrorDiagnoser.diagnose(props.error)
        
        if (result.action === "COOLING") {

          const currentState = statusManager.getState(sessionCtx.modelKey)
          const retryCount = currentState?.retryCount ?? 0
          const backoffMultiplier = Math.pow(2, Math.min(retryCount, 14))
          const duration = (result.cooldownMs ?? 300000) * backoffMultiplier
          
          statusManager.markCooling(sessionCtx.modelKey, duration, result.reason)
          
          await performFailover(sessionID, sessionCtx.modelKey, sessionCtx.agent, result.reason)

        } else if (result.action === "LOCKED") {
          statusManager.markLocked(sessionCtx.modelKey, result.reason)
          await performFailover(sessionID, sessionCtx.modelKey, sessionCtx.agent, result.reason)
          
          ctx.client.tui.showToast({
            body: {
              title: "Provider Locked",
              message: `🛑 ${sessionCtx.modelKey} locked (Balance/Quota). Update config to reset.`,
              variant: "error",
              duration: 6000
            }
          }).catch(() => {})
        }
      }
    }
  }
}
