import type { MessageRenderer } from "@code-yeongyu/senpi"
import { linesComponent, normalizeRendererText, type CompletionDetails } from "@oh-my-opencode/senpi-task"

// Render the senpi-task.completion custom message as a compact card: the pre-rendered notification
// content (one block per completed task) split into terminal lines. Kept renderer-only so it never
// participates in the LLM context beyond the message the engine already built.
export const renderTaskCompletion: MessageRenderer<readonly CompletionDetails[]> = (message) => {
  const content = typeof message.content === "string" ? message.content : ""
  return linesComponent(content.length > 0 ? content.split("\n").map(normalizeRendererText) : ["(task completion)"])
}
