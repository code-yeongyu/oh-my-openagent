import type { ActivityBus } from "../../features/activity-bus"
import { renderStatusSummary } from "../../features/activity-bus/renderers/task-indicator"

type ToolExecuteInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolAfterOutput = {
  title: string
  output: string
  metadata: unknown
}

export function createActivityIndicatorHook(activityBus?: ActivityBus) {
  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolAfterOutput,
  ): Promise<void> => {
    // Only intercept task/delegate tool calls
    if (input.tool !== "task" && input.tool !== "delegate") return
    if (typeof output.output !== "string") return
    if (!activityBus) return

    const snapshot = activityBus.getSnapshot()
    const summary = renderStatusSummary(snapshot.running, snapshot.queued)
    output.output = `${output.output}\n\n${summary}`
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
