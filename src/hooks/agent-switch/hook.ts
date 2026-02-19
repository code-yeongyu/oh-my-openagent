import type { PluginInput } from "@opencode-ai/plugin"
import { getPendingSwitch, setPendingSwitch } from "../../features/agent-switch"
import { applyPendingSwitch, clearPendingSwitchRuntime } from "../../features/agent-switch/applier"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { log } from "../../shared/logger"
import {
  buildFallbackContext,
  detectFallbackHandoffTarget,
  extractTextPartsFromMessageResponse,
  isTerminalFinishValue,
  isTerminalStepFinishPart,
} from "./fallback-handoff"

const processedFallbackMessages = new Set<string>()
const MAX_PROCESSED_FALLBACK_MARKERS = 500

function getSessionIDFromStatusEvent(input: { event: { properties?: Record<string, unknown> } }): string | undefined {
  const props = input.event.properties as Record<string, unknown> | undefined
  const fromProps = typeof props?.sessionID === "string" ? props.sessionID : undefined
  if (fromProps) {
    return fromProps
  }

  const status = props?.status as Record<string, unknown> | undefined
  const fromStatus = typeof status?.sessionID === "string" ? status.sessionID : undefined
  return fromStatus
}

function getStatusTypeFromEvent(input: { event: { properties?: Record<string, unknown> } }): string | undefined {
  const props = input.event.properties as Record<string, unknown> | undefined
  const directType = typeof props?.type === "string" ? props.type : undefined
  if (directType) {
    return directType
  }

  const status = props?.status as Record<string, unknown> | undefined
  const statusType = typeof status?.type === "string" ? status.type : undefined
  return statusType
}

export function createAgentSwitchHook(ctx: PluginInput) {
  return {
    event: async (input: { event: { type: string; properties?: Record<string, unknown> } }): Promise<void> => {
      if (input.event.type === "session.deleted") {
        const props = input.event.properties as Record<string, unknown> | undefined
        const info = props?.info as Record<string, unknown> | undefined
        const deletedSessionID = info?.id
        if (typeof deletedSessionID === "string") {
          clearPendingSwitchRuntime(deletedSessionID)
          for (const key of Array.from(processedFallbackMessages)) {
            if (key.startsWith(`${deletedSessionID}:`)) {
              processedFallbackMessages.delete(key)
            }
          }
        }
        return
      }

      if (input.event.type === "session.error") {
        const props = input.event.properties as Record<string, unknown> | undefined
        const info = props?.info as Record<string, unknown> | undefined
        const erroredSessionID = info?.id ?? props?.sessionID
        if (typeof erroredSessionID === "string") {
          clearPendingSwitchRuntime(erroredSessionID)
          for (const key of Array.from(processedFallbackMessages)) {
            if (key.startsWith(`${erroredSessionID}:`)) {
              processedFallbackMessages.delete(key)
            }
          }
        }
        return
      }

      if (input.event.type === "message.updated") {
        const props = input.event.properties as Record<string, unknown> | undefined
        const info = props?.info as Record<string, unknown> | undefined
        const sessionID = typeof info?.sessionID === "string" ? info.sessionID : undefined
        const messageID = typeof info?.id === "string" ? info.id : undefined
        const agent = typeof info?.agent === "string" ? info.agent : undefined
        const finish = info?.finish

        if (!sessionID) {
          return
        }

        const isTerminalAssistantUpdate = isTerminalFinishValue(finish)
        if (!isTerminalAssistantUpdate) {
          return
        }

        // Primary path: if switch_agent queued a pending switch, apply it as soon as
        // assistant turn is terminal (no reliance on session.idle timing).
        if (getPendingSwitch(sessionID)) {
          await applyPendingSwitch({
            sessionID,
            client: ctx.client,
            source: "message-updated",
          })
          return
        }

        if (!messageID) {
          return
        }

        if (getAgentConfigKey(agent ?? "") !== "athena") {
          return
        }

        const marker = `${sessionID}:${messageID}`
        if (processedFallbackMessages.has(marker)) {
          return
        }
        processedFallbackMessages.add(marker)

        // Prevent unbounded growth of the Set
        if (processedFallbackMessages.size > MAX_PROCESSED_FALLBACK_MARKERS) {
          const iterator = processedFallbackMessages.values()
          const oldest = iterator.next().value
          if (oldest) {
            processedFallbackMessages.delete(oldest)
          }
        }

        // If switch_agent already queued a handoff, do not synthesize fallback behavior.
        if (getPendingSwitch(sessionID)) {
          return
        }

        try {
          const response = await ctx.client.session.message({
            path: { id: sessionID, messageID },
          })
          const text = extractTextPartsFromMessageResponse(response)
          const target = detectFallbackHandoffTarget(text)
          if (!target) {
            return
          }

          setPendingSwitch(sessionID, target, buildFallbackContext(target))
          log("[agent-switch] Recovered missing switch_agent tool call from Athena handoff text", {
            sessionID,
            messageID,
            target,
          })

          await applyPendingSwitch({
            sessionID,
            client: ctx.client,
            source: "athena-message-fallback",
          })
        } catch (error) {
          processedFallbackMessages.delete(marker)
          log("[agent-switch] Failed to recover fallback handoff from Athena message", {
            sessionID,
            messageID,
            error: String(error),
          })
        }

        return
      }

      if (input.event.type === "message.part.updated") {
        const props = input.event.properties as Record<string, unknown> | undefined
        const part = props?.part
        const info = props?.info as Record<string, unknown> | undefined
        const sessionIDFromPart = typeof (part as Record<string, unknown> | undefined)?.sessionID === "string"
          ? ((part as Record<string, unknown>).sessionID as string)
          : undefined
        const sessionIDFromInfo = typeof info?.sessionID === "string" ? info.sessionID : undefined
        const sessionID = sessionIDFromPart ?? sessionIDFromInfo
        if (!sessionID) {
          return
        }

        if (!isTerminalStepFinishPart(part)) {
          return
        }

        if (!getPendingSwitch(sessionID)) {
          return
        }

        await applyPendingSwitch({
          sessionID,
          client: ctx.client,
          source: "message-part-step-finish",
        })
        return
      }

      if (input.event.type === "session.idle") {
        const props = input.event.properties as Record<string, unknown> | undefined
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        await applyPendingSwitch({
          sessionID,
          client: ctx.client,
          source: "idle",
        })
        return
      }

      if (input.event.type === "session.status") {
        const sessionID = getSessionIDFromStatusEvent(input)
        const statusType = getStatusTypeFromEvent(input)
        if (!sessionID || statusType !== "idle") {
          return
        }

        await applyPendingSwitch({
          sessionID,
          client: ctx.client,
          source: "status-idle",
        })
      }
    },
  }
}
