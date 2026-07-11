import type { MessageRenderer } from "@code-yeongyu/senpi"
import {
  completionMessageLines,
  linesComponent,
  type CompletionDetails,
} from "@oh-my-opencode/senpi-task"

// Render completion details as user-facing rows without exposing the LLM-facing notification envelope.
export const renderTaskCompletion: MessageRenderer<readonly CompletionDetails[]> = (message) => {
  const details = message.details ?? []
  if (details.length === 0) return linesComponent(["(task completion)"])
  return linesComponent((width) => completionMessageLines(details, width))
}
