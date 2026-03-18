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
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> },
    ) => {
      const normalizedToolName = input.tool.toLowerCase()
      if (
        normalizedToolName !== "question"
        && normalizedToolName !== "ask_user_question"
        && normalizedToolName !== "askuserquestion"
      ) {
        return
      }

      // question tool uses args.questions array, not args.question
      const questions = Array.isArray(output.args.questions) ? output.args.questions : []
      const question = questions.length > 0 && typeof questions[0]?.question === "string"
        ? questions[0].question
        : typeof output.args.question === "string" ? output.args.question : undefined
      const context: OpenClawContext = {
        sessionId: input.sessionID,
        projectPath: ctx.directory,
        question,
      }
      await handleWake("ask-user-question", context)
    },
  }
}
