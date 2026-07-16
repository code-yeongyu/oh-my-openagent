import type { PluginContext } from "./types"
import { randomUUID } from "node:crypto"

import { getMainSessionID } from "../features/claude-code-session-state"
import { log, replaceToolArgs } from "../shared"
import { stripInvisibleAgentCharacters } from "../shared/agent-display-names"
import { resolveSessionAgent } from "./session-agent-resolver"
import { isRalphLoopResumeArgument, parseRalphLoopArguments } from "../hooks/ralph-loop/command-arguments"
import { ULTRAWORK_VERIFICATION_PROMISE } from "../hooks/ralph-loop/constants"
import { readState, writeState } from "../hooks/ralph-loop/storage"
import { stopContinuation } from "./stop-continuation"

import type { CreatedHooks } from "../create-hooks"
import type { BackgroundManager } from "../features/background-agent"

const BACKGROUND_WAIT_BLOCK_MESSAGE = [
  "Background task wait is already managed by the plugin.",
  "End this response now and wait for the <system-reminder> completion notification.",
  "After that reminder arrives, call background_output with the task_id from the launch result.",
].join(" ")

function isPureSleepCommand(command: string): boolean {
  const commandLines = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))

  return commandLines.length > 0
    && commandLines.every((line) => /^sleep\s+\d+(?:\.\d+)?[smhd]?\s*$/i.test(line))
}

function getLoopCommandArguments(args: Record<string, unknown>, command: "ralph-loop" | "ulw-loop"): string {
  const rawUserMessage = typeof args.user_message === "string" ? args.user_message.trim() : ""
  if (rawUserMessage) {
    return rawUserMessage
  }

  const rawName = typeof args.name === "string" ? args.name : ""
  return rawName.replace(new RegExp(`^/?(${command})\\s*`, "i"), "")
}

export function createToolExecuteBeforeHandler(args: {
  ctx: PluginContext
  hooks: CreatedHooks
  backgroundManager?: Pick<
    BackgroundManager,
    "hasActiveChildTasks" | "hasActiveDescendantTasks" | "hasPendingParentWake"
  >
  blockOnBackgroundTasks?: boolean
}): (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void> {
  const { ctx, hooks, backgroundManager, blockOnBackgroundTasks } = args

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
    // Strip mcp_ prefix from tool names — the model may emit mcp_background_output
    // but the runtime registry has it as background_output (fixes #2697)
    if (/^mcp_/i.test(input.tool)) {
      const stripped = input.tool.replace(/^mcp_/i, "")
      log("[tool-execute-before] Stripped mcp_ prefix from tool name", {
        original: input.tool,
        resolved: stripped,
        sessionID: input.sessionID,
        callID: input.callID,
      })
      input.tool = stripped
    }

    if (input.tool.toLowerCase() === "bash" && typeof output.args.command === "string") {
      if (output.args.command.includes("\x00")) {
        replaceToolArgs(output, { command: output.args.command.replace(/\x00/g, "") })
        log("[tool-execute-before] Stripped null bytes from bash command", {
          sessionID: input.sessionID,
          callID: input.callID,
        })
      }

      if (
        isPureSleepCommand(output.args.command)
        && (
          (blockOnBackgroundTasks
            ? backgroundManager?.hasActiveDescendantTasks(input.sessionID)
            : backgroundManager?.hasActiveChildTasks(input.sessionID)) === true
          || backgroundManager?.hasPendingParentWake(input.sessionID) === true
        )
      ) {
        throw new Error(BACKGROUND_WAIT_BLOCK_MESSAGE)
      }
    }

    await hooks.writeExistingFileGuard?.["tool.execute.before"]?.(input, output)
    await hooks.notepadWriteGuard?.["tool.execute.before"]?.(input, output)
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
      await hooks.fsyncSkipWarning?.["tool.execute.before"]?.(input, output)
      await hooks.prometheusMdOnly?.["tool.execute.before"]?.(input, output)
    await hooks.sisyphusJuniorNotepad?.["tool.execute.before"]?.(input, output)
    await hooks.atlasHook?.["tool.execute.before"]?.(input, output)
    await hooks.compactionTodoPreserver?.["tool.execute.before"]?.(input, output)
    await hooks.teamToolGating?.["tool.execute.before"]?.(input, output)

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
      const category = typeof output.args.category === "string" ? output.args.category : undefined
      const subagentType = typeof output.args.subagent_type === "string" ? output.args.subagent_type : undefined
      const taskId = typeof output.args.task_id === "string" ? output.args.task_id : undefined

      if (category) {
        replaceToolArgs(output, { subagent_type: "sisyphus-junior" })
      } else if (!subagentType && taskId) {
        const resolvedAgent = await resolveSessionAgent(ctx.client, taskId)
        replaceToolArgs(output, { subagent_type: resolvedAgent ?? "continue" })
      }

      const normalizedSubagentType =
        typeof output.args.subagent_type === "string" ? stripInvisibleAgentCharacters(output.args.subagent_type) : undefined
      const prompt = typeof output.args.prompt === "string" ? output.args.prompt : ""
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
        replaceToolArgs(output, {
          run_in_background: false,
          prompt: buildUltraworkOracleVerificationPrompt(
            prompt,
            loopState.prompt,
            verificationAttemptId,
          ),
        })
      }
    }

    if (hooks.ralphLoop && input.tool === "skill") {
      const rawName = typeof output.args.name === "string" ? output.args.name : undefined
      const command = rawName?.replace(/^\//, "").toLowerCase()
      const sessionID = input.sessionID || getMainSessionID()

      if (command === "ralph-loop" && sessionID) {
        const rawArgs = getLoopCommandArguments(output.args, "ralph-loop")
        const parsedArguments = parseRalphLoopArguments(rawArgs)
        const resumed = isRalphLoopResumeArgument(rawArgs)
          && hooks.ralphLoop.resumeLoop?.(sessionID) === true
        if (!resumed) {
          hooks.ralphLoop.startLoop(sessionID, parsedArguments.prompt, {
            maxIterations: parsedArguments.maxIterations,
            completionPromise: parsedArguments.completionPromise,
            strategy: parsedArguments.strategy,
          })
        }
      } else if (command === "cancel-ralph" && sessionID) {
        hooks.ralphLoop.cancelLoop(sessionID)
      } else if (command === "ulw-loop" && sessionID) {
        const rawArgs = getLoopCommandArguments(output.args, "ulw-loop")
        const parsedArguments = parseRalphLoopArguments(rawArgs)
        const resumed = isRalphLoopResumeArgument(rawArgs)
          && hooks.ralphLoop.resumeLoop?.(sessionID) === true
        if (!resumed) {
          hooks.ralphLoop.startLoop(sessionID, parsedArguments.prompt, {
            ultrawork: true,
            maxIterations: parsedArguments.maxIterations,
            completionPromise: parsedArguments.completionPromise,
            strategy: parsedArguments.strategy,
          })
        }
      }
    }

    if (input.tool === "skill") {
      const rawName = typeof output.args.name === "string" ? output.args.name : undefined
      const command = rawName?.replace(/^\//, "").toLowerCase()
      const sessionID = input.sessionID || getMainSessionID()

      if (command === "stop-continuation" && sessionID) {
        stopContinuation({ directory: ctx.directory, hooks, sessionID })
      }

      // Clear stop state when user explicitly resumes work via work-starting commands.
      // This ensures /stop-continuation persists until the user intentionally restarts.
      const workStartingCommands = ["start-work", "ralph-loop", "ulw-loop"]
      if (workStartingCommands.includes(command ?? "") && sessionID) {
        if (hooks.stopContinuationGuard?.isStopped(sessionID)) {
          hooks.stopContinuationGuard.clear(sessionID)
          log("[stop-continuation] Stop state cleared by work-starting command", {
            sessionID,
            command,
          })
        }
      }
    }
  }
}
