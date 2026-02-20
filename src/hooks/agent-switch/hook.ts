import type { PluginInput } from "@opencode-ai/plugin"
import { getPendingSwitch } from "../../features/agent-switch"
import { applyPendingSwitch, clearPendingSwitchRuntime } from "../../features/agent-switch/applier"
import {
  isTerminalFinishValue,
  isTerminalStepFinishPart,
} from "./terminal-detection"

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
        }
        return
      }

      if (input.event.type === "session.error") {
        const props = input.event.properties as Record<string, unknown> | undefined
        const info = props?.info as Record<string, unknown> | undefined
        const erroredSessionID = info?.id ?? props?.sessionID
        if (typeof erroredSessionID === "string") {
          clearPendingSwitchRuntime(erroredSessionID)
        }
        return
      }

      if (input.event.type === "message.updated") {
        const props = input.event.properties as Record<string, unknown> | undefined
        const info = props?.info as Record<string, unknown> | undefined
        const sessionID = typeof info?.sessionID === "string" ? info.sessionID : undefined
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
