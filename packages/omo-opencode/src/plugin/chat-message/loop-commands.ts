import type { OhMyOpenCodeConfig } from "../../config"

import { AUTO_SLASH_COMMAND_TAG_OPEN } from "../../hooks/auto-slash-command/constants"
import { parseGoalCommand } from "../../hooks/goal/command-arguments"
import { MAX_OBJECTIVE_LENGTH } from "../../hooks/goal/validation"
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
  readonly originalPromptText?: string
}): void {
  const { hooks, input, output, isFirstMessage, pluginConfig, nativeGoalCommand } = args
  if (!hooks.goal || nativeGoalCommand) {
    return
  }

  const promptText = args.originalPromptText ?? extractPromptText(output.parts)
  if (promptText.includes(AUTO_SLASH_COMMAND_TAG_OPEN)) {
    return
  }
  // The parser accepts bare arguments for native commands, not ordinary chat.
  const goalCommand = promptText.trim().match(/^\/goal(?:\s+([\s\S]*))?$/i)
  if (!goalCommand) {
    const objective = promptText.trim()
    if (
      isFirstMessage
      && pluginConfig.default_mode?.goal
      && objective.length > 0
      && objective.length <= MAX_OBJECTIVE_LENGTH
    ) {
      hooks.goal.setGoal(input.sessionID, objective)
      log("[chat-message] Default goal auto-started", { sessionID: input.sessionID, objective })
    }
    return
  }
  const parsed = parseGoalCommand(goalCommand[1] ?? "")

  switch (parsed.kind) {
    case "setObjective":
      hooks.goal.setGoal(input.sessionID, parsed.objective)
      log("[chat-message] Goal set", { sessionID: input.sessionID, objective: parsed.objective })
      break
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
}
