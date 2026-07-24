import type { OhMyOpenCodeConfig } from "../../config"

import { detectSlashCommand, removeCodeBlocks } from "../../hooks/auto-slash-command/detector"
import { parseGoalCommand } from "../../hooks/goal/command-arguments"
import { checkObjective } from "../../hooks/goal/validation"
import { log } from "../../shared"
import { NATIVE_LOOP_TRIGGERED_FLAG } from "../command-execute-before"
import type { ChatMessageHooks, ChatMessageHandlerOutput, ChatMessageInput } from "./types"

export function handleGoalMessage(args: {
  readonly hooks: ChatMessageHooks
  readonly input: ChatMessageInput
  readonly output: ChatMessageHandlerOutput
  readonly isFirstMessage: boolean
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly rawPromptText: string
}): void {
  const { hooks, input, output, isFirstMessage, pluginConfig, rawPromptText } = args
  if (!hooks.goal || output.message[NATIVE_LOOP_TRIGGERED_FLAG] === true) {
    return
  }

  // A `/goal ...` command typed as a chat message (fallback for when command.execute.before
  // did not intercept it). Only a genuine slash command drives the goal switch, parsed from
  // the command arguments — a normal user message is never treated as an objective.
  const slashCommand = detectSlashCommand(rawPromptText)
  if (slashCommand?.command === "goal") {
    // Preserve multi-line objectives: the slash-command regex is not dotall, so re-derive the
    // args from the raw prompt (same code-block handling detectSlashCommand used).
    const goalArgs = removeCodeBlocks(rawPromptText).trim().replace(/^\/goal[ \t]*/i, "")
    const parsed = parseGoalCommand(goalArgs)
    switch (parsed.kind) {
      case "setObjective": {
        const check = checkObjective(parsed.objective)
        if (!check.ok) {
          log("[chat-message] Goal not set: invalid objective", { sessionID: input.sessionID, reason: check.error })
          break
        }
        hooks.goal.setGoal(input.sessionID, check.objective)
        log("[chat-message] Goal set", { sessionID: input.sessionID, objective: check.objective })
        break
      }
      case "setStatus":
        if (parsed.status === "paused") {
          hooks.goal.pauseGoal(input.sessionID)
          log("[chat-message] Goal paused", { sessionID: input.sessionID })
        } else {
          hooks.goal.resumeGoal(input.sessionID)
          log("[chat-message] Goal resumed", { sessionID: input.sessionID })
        }
        break
      case "clear":
        hooks.goal.clearGoal(input.sessionID)
        log("[chat-message] Goal cleared", { sessionID: input.sessionID })
        break
      case "show":
        // No side effect; the goal is surfaced by the TUI mirror and tools.
        break
      default:
        break
    }
    return
  }

  // Auto-start a goal from the first main-session message. Opt in via goal.auto_start,
  // or the default_mode.goal mode toggle, which enables the same behavior.
  if (isFirstMessage && (pluginConfig.goal?.auto_start || pluginConfig.default_mode?.goal)) {
    const check = checkObjective(rawPromptText)
    if (check.ok) {
      hooks.goal.setGoal(input.sessionID, check.objective)
      log("[chat-message] Default goal auto-started", { sessionID: input.sessionID, objective: check.objective })
    } else {
      log("[chat-message] Default goal skipped: invalid objective", { sessionID: input.sessionID, reason: check.error })
    }
  }
}
