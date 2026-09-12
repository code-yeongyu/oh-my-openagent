import type { OhMyOpenCodeConfig } from "../../config"

import { AUTO_SLASH_COMMAND_TAG_OPEN } from "../../hooks/auto-slash-command/constants"
import { parseGoalCommand } from "../../hooks/goal/command-arguments"
import { truncateObjective } from "../../hooks/goal/validation"
import { log } from "../../shared"
import { extractPromptText } from "./prompt-text"
import type { ChatMessageHooks, ChatMessageHandlerOutput, ChatMessageInput } from "./types"

export function handleGoalMessage(args: {
  readonly hooks: ChatMessageHooks
  readonly input: ChatMessageInput
  readonly output: ChatMessageHandlerOutput
  readonly isFirstMessage: boolean
  readonly pluginConfig: OhMyOpenCodeConfig
  readonly nativeGoalCommand: boolean
}): void {
  const { hooks, input, output, isFirstMessage, pluginConfig, nativeGoalCommand } = args
  if (!hooks.goal || nativeGoalCommand) {
    return
  }

  const promptText = extractPromptText(output.parts)
  if (promptText.includes(AUTO_SLASH_COMMAND_TAG_OPEN)) {
    return
  }
  const parsed = parseGoalCommand(promptText)

  switch (parsed.kind) {
    case "setObjective": {
      // An over-long prompt must never abort the message (#6391): clamp it and note the loss.
      const objective = truncateObjective(parsed.objective)
      if (objective.length !== parsed.objective.length) {
        log("[chat-message] Goal objective exceeded length limit; truncated", {
          sessionID: input.sessionID,
          originalLength: parsed.objective.length,
          truncatedLength: objective.length,
        })
      }
      hooks.goal.setGoal(input.sessionID, objective)
      log("[chat-message] Goal set", { sessionID: input.sessionID, objective })
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
      // No side effect; the goal is surfaced by TUI mirror and tools.
      break
    default:
      break
  }

  if (
    parsed.kind === "show"
    && isFirstMessage
    && pluginConfig.default_mode?.goal
  ) {
    // Same clamp as the explicit objective path so auto-start cannot crash the first prompt.
    const objective = truncateObjective(promptText)
    if (objective.length > 0) {
      if (objective.length !== promptText.trim().length) {
        log("[chat-message] Default goal objective exceeded length limit; truncated", {
          sessionID: input.sessionID,
          originalLength: promptText.trim().length,
          truncatedLength: objective.length,
        })
      }
      hooks.goal.setGoal(input.sessionID, objective)
      log("[chat-message] Default goal auto-started", { sessionID: input.sessionID, objective })
    }
  }
}
