import type { PluginContext } from "./types"

import { getMainSessionID } from "../features/claude-code-session-state"
import { clearBoulderState } from "../features/boulder-state"
import { log } from "../shared"
import { resolveSessionAgent } from "./session-agent-resolver"

import type { CreatedHooks } from "../create-hooks"

export function createToolExecuteBeforeHandler(args: {
  ctx: PluginContext
  hooks: CreatedHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void> {
  const { ctx, hooks } = args

  return async (input, output): Promise<void> => {
    await hooks.writeExistingFileGuard?.["tool.execute.before"]?.(input, output)
    await hooks.questionLabelTruncator?.["tool.execute.before"]?.(input, output)
    await hooks.claudeCodeHooks?.["tool.execute.before"]?.(input, output)
    await hooks.nonInteractiveEnv?.["tool.execute.before"]?.(input, output)
    await hooks.commentChecker?.["tool.execute.before"]?.(input, output)
    await hooks.directoryAgentsInjector?.["tool.execute.before"]?.(input, output)
    await hooks.directoryReadmeInjector?.["tool.execute.before"]?.(input, output)
    await hooks.rulesInjector?.["tool.execute.before"]?.(input, output)
    await hooks.tasksTodowriteDisabler?.["tool.execute.before"]?.(input, output)
    await hooks.prometheusMdOnly?.["tool.execute.before"]?.(input, output)
    await hooks.sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output)
    await hooks.atlasHook?.["tool.execute.before"]?.(input, output)

    if (input.tool === "task") {
      const argsObject = output.args
      const category = typeof argsObject.category === "string" ? argsObject.category : undefined
      const subagentType = typeof argsObject.subagent_type === "string" ? argsObject.subagent_type : undefined
      const sessionId = typeof argsObject.session_id === "string" ? argsObject.session_id : undefined

      if (category) {
        argsObject.subagent_type = "sisyphus-junior"
      } else if (!subagentType && sessionId) {
        const resolvedAgent = await resolveSessionAgent(ctx.client, sessionId)
        argsObject.subagent_type = resolvedAgent ?? "continue"
      }
    }

    if (hooks.ralphLoop && input.tool === "slashcommand") {
      const rawCommand = typeof output.args.command === "string" ? output.args.command : undefined
      const command = rawCommand?.replace(/^\//, "").toLowerCase()
      const sessionID = input.sessionID || getMainSessionID()

      if (command === "ralph-loop" && sessionID) {
        const rawArgs = rawCommand?.replace(/^\/?(ralph-loop)\s*/i, "") || ""
        const taskMatch = rawArgs.match(/^["'](.+?)["']/)
        const prompt =
          taskMatch?.[1] ||
          rawArgs.split(/\s+--/)[0]?.trim() ||
          "Complete the task as instructed"

        const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i)
        const promiseMatch = rawArgs.match(/--completion-promise=["']?([^"'\s]+)["']?/i)

        hooks.ralphLoop.startLoop(sessionID, prompt, {
          maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
          completionPromise: promiseMatch?.[1],
        })
      } else if (command === "cancel-ralph" && sessionID) {
        hooks.ralphLoop.cancelLoop(sessionID)
      } else if (command === "ulw-loop" && sessionID) {
        const rawArgs = rawCommand?.replace(/^\/?(ulw-loop)\s*/i, "") || ""
        const taskMatch = rawArgs.match(/^["'](.+?)["']/)
        const prompt =
          taskMatch?.[1] ||
          rawArgs.split(/\s+--/)[0]?.trim() ||
          "Complete the task as instructed"

        const maxIterMatch = rawArgs.match(/--max-iterations=(\d+)/i)
        const promiseMatch = rawArgs.match(/--completion-promise=["']?([^"'\s]+)["']?/i)

        hooks.ralphLoop.startLoop(sessionID, prompt, {
          ultrawork: true,
          maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
          completionPromise: promiseMatch?.[1],
        })
      }
    }

    if (input.tool === "slashcommand") {
      const rawCommand = typeof output.args.command === "string" ? output.args.command : undefined
      const command = rawCommand?.replace(/^\//, "").toLowerCase()
      const sessionID = input.sessionID || getMainSessionID()

      if (command === "stop-continuation" && sessionID) {
        hooks.stopContinuationGuard?.stop(sessionID)
        hooks.todoContinuationEnforcer?.cancelAllCountdowns()
        hooks.ralphLoop?.cancelLoop(sessionID)
        clearBoulderState(ctx.directory)
        log("[stop-continuation] All continuation mechanisms stopped", {
          sessionID,
        })
      }
    }
  }
}
