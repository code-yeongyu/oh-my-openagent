import type { PluginContext } from "./types"

import { getMainSessionID } from "../features/claude-code-session-state"
import { log, replaceToolArgs } from "../shared"
import { resolveSessionAgent } from "./session-agent-resolver"
import { stopContinuation } from "./stop-continuation"

import type { CreatedHooks } from "../create-hooks"
import type { BackgroundManager } from "../features/background-agent"

const BACKGROUND_REMINDER_WAIT_BLOCK_MESSAGE = [
  "Background task wait is already managed by the plugin.",
  "End this response now and wait for the <system-reminder> completion notification.",
  "After that reminder arrives, call background_output with the task_id from the launch result.",
].join(" ")

const BACKGROUND_TOOL_WAIT_BLOCK_MESSAGE = [
  "Background task wait is already managed by the plugin.",
  "Call `wait-for-background-tasks` now instead of sleeping or ending this response.",
  "After it returns, call background_output with each completed task_id.",
].join(" ")

function isPureSleepCommand(command: string): boolean {
  const commandLines = command
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))

  return commandLines.length > 0
    && commandLines.every((line) => /^sleep\s+\d+(?:\.\d+)?[smhd]?\s*$/i.test(line))
}

export function createToolExecuteBeforeHandler(args: {
  ctx: PluginContext
  hooks: CreatedHooks
  backgroundManager?: Pick<
    BackgroundManager,
    "hasActiveChildTasks" | "hasActiveDescendantTasks" | "hasPendingParentWake"
  >
  blockOnBackgroundTasks?: boolean
  canUseBackgroundWaitTool?: (sessionID: string) => boolean
}): (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: Record<string, unknown> },
) => Promise<void> {
  const { ctx, hooks, backgroundManager, blockOnBackgroundTasks, canUseBackgroundWaitTool } = args

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

      const useBlockingWaitTool = blockOnBackgroundTasks === true
        && canUseBackgroundWaitTool?.(input.sessionID) !== false

      if (
        isPureSleepCommand(output.args.command)
        && (
          (useBlockingWaitTool
            ? backgroundManager?.hasActiveDescendantTasks(input.sessionID)
            : backgroundManager?.hasActiveChildTasks(input.sessionID)) === true
          || backgroundManager?.hasPendingParentWake(input.sessionID) === true
        )
      ) {
        throw new Error(
          useBlockingWaitTool
            ? BACKGROUND_TOOL_WAIT_BLOCK_MESSAGE
            : BACKGROUND_REMINDER_WAIT_BLOCK_MESSAGE,
        )
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
    }

    if (input.tool === "skill") {
      const rawName = typeof output.args.name === "string" ? output.args.name : undefined
      const command = rawName?.replace(/^\//, "").toLowerCase()
      const sessionID = input.sessionID || getMainSessionID()

      if (command === "stop-continuation" && sessionID) {
        stopContinuation({ directory: ctx.directory, hooks, sessionID })
      }

      if (command === "goal" && sessionID && hooks.goal) {
        const rawArgs = typeof output.args.user_message === "string"
          ? output.args.user_message.trim()
          : typeof output.args.arguments === "string"
            ? output.args.arguments.trim()
            : ""
        if (rawArgs.length > 0) {
          hooks.goal.setGoal(sessionID, rawArgs)
        }
      }

      // Clear stop state when user explicitly resumes work via work-starting commands.
      // This ensures /stop-continuation persists until the user intentionally restarts.
      const workStartingCommands = ["start-work"]
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
