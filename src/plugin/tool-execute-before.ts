import type { PluginContext } from "./types"

import { getMainSessionID } from "../features/claude-code-session-state"
import { log } from "../shared"

import type { CreatedHooks } from "../create-hooks"
import { handleRalphLoopSkillCommand } from "./ralph-loop-skill-command"
import { finalizeStopContinuation } from "./stop-continuation-finalization"
import { prepareTaskToolArguments } from "./task-tool-arguments"

export function createToolExecuteBeforeHandler(args: {
  ctx: PluginContext
  hooks: CreatedHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void> {
  const { ctx, hooks } = args

  return async (input, output): Promise<void> => {
    if (input.tool.toLowerCase() === "bash" && typeof output.args.command === "string") {
      if (output.args.command.includes("\u0000")) {
        output.args.command = output.args.command.replaceAll("\u0000", "")
        log("[tool-execute-before] Stripped null bytes from bash command", {
          sessionID: input.sessionID,
          callID: input.callID,
        })
      }
    }

    await hooks.writeExistingFileGuard?.["tool.execute.before"]?.(input, output)
    await hooks.questionLabelTruncator?.["tool.execute.before"]?.(input, output)
    await hooks.claudeCodeHooks?.["tool.execute.before"]?.(input, output)
    await hooks.nonInteractiveEnv?.["tool.execute.before"]?.(input, output)
    await hooks.bashFileReadGuard?.["tool.execute.before"]?.(input, output)
    await hooks.commentChecker?.["tool.execute.before"]?.(input, output)
    await hooks.directoryAgentsInjector?.["tool.execute.before"]?.(input, output)
    await hooks.directoryReadmeInjector?.["tool.execute.before"]?.(input, output)
    await hooks.rulesInjector?.["tool.execute.before"]?.(input, output)
    await hooks.tasksTodowriteDisabler?.["tool.execute.before"]?.(input, output)
    await hooks.webfetchRedirectGuard?.["tool.execute.before"]?.(input, output)
    await hooks.prometheusMdOnly?.["tool.execute.before"]?.(input, output)
    await hooks.sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output)
    await hooks.atlasHook?.["tool.execute.before"]?.(input, output)

    const normalizedToolName = input.tool.toLowerCase()
    if (
      normalizedToolName === "question"
      || normalizedToolName === "ask_user_question"
      || normalizedToolName === "askuserquestion"
    ) {
      const sessionID = input.sessionID || getMainSessionID()
      await hooks.sessionNotification?.({
        event: {
          type: "tool.execute.before",
          properties: {
            sessionID,
            tool: input.tool,
            args: output.args,
          },
        },
      })
    }

    if (input.tool === "task") {
      await prepareTaskToolArguments({
        ctx,
        sessionID: input.sessionID,
        callID: input.callID,
        argsObject: output.args,
      })
    }

    if (input.tool === "skill") {
      const rawName = typeof output.args.name === "string" ? output.args.name : undefined
      const command = rawName?.replace(/^\//, "").toLowerCase()
      const sessionID = input.sessionID || getMainSessionID()

      if (!sessionID) {
        return
      }

      handleRalphLoopSkillCommand({
        hooks,
        sessionID,
        command,
        outputArgs: output.args,
      })

      if (command === "stop-continuation") {
        finalizeStopContinuation({
          directory: ctx.directory,
          sessionID,
          hooks,
        })
      }
    }
  }
}
