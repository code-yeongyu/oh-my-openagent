import type { PluginContext } from "../plugin/types"
import type { OhMyOpenCodeConfig } from "../config"
import { wakeOpenClaw } from "../openclaw"
import type { OpenClawContext } from "../openclaw/types"


export function createOpenClawHook(
  ctx: PluginContext,
  pluginConfig: OhMyOpenCodeConfig,
) {
  const config = pluginConfig.openclaw
  if (!config?.enabled) return null

  const handleWake = async (event: string, context: OpenClawContext) => {
    await wakeOpenClaw(config, event, context)
  }

  return {
    event: async (input: any) => {
      const { event } = input
      const props = event.properties || {}
      const sessionID = props.sessionID || props.info?.id

      const context: OpenClawContext = {
        sessionId: sessionID,
        projectPath: ctx.directory,
      }

      if (event.type === "session.created") {
        await handleWake("session-start", context)
      } else if (event.type === "session.deleted") {
        await handleWake("session-end", context)
      } else if (event.type === "session.idle") {
        // Check if we are waiting for user input (ask-user-question)
        // This is heuristic. If the last message was from assistant and ended with a question?
        // Or if the system is idle.
        await handleWake("session-idle", context)
      } else if (event.type === "session.stopped") { // Assuming this event exists or map from error?
        await handleWake("stop", context)
      }
    },
    
    toolExecuteBefore: async (input: any) => {
        const { toolName, toolInput, sessionID } = input
        if (toolName === "ask_user" || toolName === "ask_followup_question") {
             const context: OpenClawContext = {
                sessionId: sessionID,
                projectPath: ctx.directory,
                question: toolInput.question,
             }
             await handleWake("ask-user-question", context)
        }
    }
  }
}
