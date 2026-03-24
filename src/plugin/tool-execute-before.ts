import type { PluginContext } from "./types"
import { randomUUID } from "node:crypto"

import { getMainSessionID } from "../features/claude-code-session-state"
import { clearBoulderState } from "../features/boulder-state"
import { log } from "../shared"
import { resolveSessionAgent } from "./session-agent-resolver"
import { parseRalphLoopArguments } from "../hooks/ralph-loop/command-arguments"
import { ULTRAWORK_VERIFICATION_PROMISE } from "../hooks/ralph-loop/constants"
import { readState, writeState } from "../hooks/ralph-loop/storage"

import type { CreatedHooks } from "../create-hooks"

export function createToolExecuteBeforeHandler(args: {
  ctx: PluginContext
  hooks: CreatedHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void> {
  const { ctx, hooks } = args

  function buildUltraworkOracleVerificationPrompt(prompt: string, originalTask: string, verificationAttemptId: string): string {
    const verificationPrompt = [
      "You are verifying the active ULTRAWORK loop result for this session.",
      "",
      "Original task:",
      originalTask,
      "",
      "Review the work skeptically and critically.",
      "Assume it may be incomplete, misleading, or subtly broken until the evidence proves otherwise.",
      "Look for missing scope, weak verification, process violations, hidden regressions, and any reason the task should NOT be considered complete.",
      "",
      `If the work is fully complete, end your response with <promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>.`,
      "If the work is not complete, explain the blocking issues clearly and DO NOT emit that promise.",
      "",
      `<ulw_verification_attempt_id>${verificationAttemptId}</ulw_verification_attempt_id>`,
    ].join("\n")

    return `${prompt ? `${prompt}\n\n` : ""}${verificationPrompt}`
  }

  return async (input, output): Promise<void> => {
    if (input.tool.toLowerCase() === "bash" && typeof output.args.command === "string") {
      if (output.args.command.includes("\x00")) {
        output.args.command = output.args.command.replace(/\x00/g, "")
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

      const normalizedSubagentType =
        typeof argsObject.subagent_type === "string" ? argsObject.subagent_type : undefined
      const prompt = typeof argsObject.prompt === "string" ? argsObject.prompt : ""
      const loopState = typeof ctx.directory === "string" ? readState(ctx.directory) : null
      const shouldInjectOracleVerification =
        normalizedSubagentType === "oracle"
        && loopState?.active === true
        && loopState.ultrawork === true
        && loopState.verification_pending === true
        && loopState.session_id === input.sessionID

      if (shouldInjectOracleVerification) {
        const verificationAttemptId = randomUUID()
        log("[tool-execute-before] Injecting ULW oracle verification attempt", {
          sessionID: input.sessionID,
          callID: input.callID,
          verificationAttemptId,
          loopSessionID: loopState.session_id,
        })
        writeState(ctx.directory, {
          ...loopState,
          verification_attempt_id: verificationAttemptId,
          verification_session_id: undefined,
        })
        argsObject.run_in_background = false
        argsObject.prompt = buildUltraworkOracleVerificationPrompt(
          prompt,
          loopState.prompt,
          verificationAttemptId,
        )
      }
    }

    if (hooks.ralphLoop && input.tool === "skill") {
      const rawName = typeof output.args.name === "string" ? output.args.name : undefined
      const command = rawName?.replace(/^\//, "").toLowerCase()
      const sessionID = input.sessionID || getMainSessionID()

      if (command === "ralph-loop" && sessionID) {
        const rawArgs = rawName?.replace(/^\/?(ralph-loop)\s*/i, "") || ""
        const parsedArguments = parseRalphLoopArguments(rawArgs)

        hooks.ralphLoop.startLoop(sessionID, parsedArguments.prompt, {
          maxIterations: parsedArguments.maxIterations,
          completionPromise: parsedArguments.completionPromise,
          strategy: parsedArguments.strategy,
        })
      } else if (command === "cancel-ralph" && sessionID) {
        hooks.ralphLoop.cancelLoop(sessionID)
      } else if (command === "ulw-loop" && sessionID) {
        const rawArgs = rawName?.replace(/^\/?(ulw-loop)\s*/i, "") || ""
        const parsedArguments = parseRalphLoopArguments(rawArgs)

        hooks.ralphLoop.startLoop(sessionID, parsedArguments.prompt, {
          ultrawork: true,
          maxIterations: parsedArguments.maxIterations,
          completionPromise: parsedArguments.completionPromise,
          strategy: parsedArguments.strategy,
        })
      }
    }

    if (input.tool === "skill") {
      const rawName = typeof output.args.name === "string" ? output.args.name : undefined
      const command = rawName?.replace(/^\//, "").toLowerCase()
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
