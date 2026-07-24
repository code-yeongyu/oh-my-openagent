import type { OhMyOpenCodeConfig } from "../../config"

import { parseGoalCommand } from "../../hooks/goal/command-arguments"
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
  const parsed = parseGoalCommand(promptText)

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

  if (
    parsed.kind === "show"
    && isFirstMessage
    && pluginConfig.default_mode?.goal
  ) {
    const objective = promptText.trim()
    if (objective.length > 0) {
      hooks.goal.setGoal(input.sessionID, objective)
      log("[chat-message] Default goal auto-started", { sessionID: input.sessionID, objective })
    }
  }
}
