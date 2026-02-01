import type { PluginInput } from "@opencode-ai/plugin"

const TASK_TOOLS = new Set(["task"])
const TURN_THRESHOLD = 10
const REMINDER_MESSAGE = `

The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using TaskCreate to add new tasks and TaskUpdate to update task status (set to in_progress when starting, completed when done).`

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteOutput {
  output: string
}

export function createTaskReminderHook(_ctx: PluginInput) {
  const sessionCounters = new Map<string, number>()

  const toolExecuteAfter = async (input: ToolExecuteInput, output: ToolExecuteOutput) => {
    const { tool, sessionID } = input
    const toolLower = tool.toLowerCase()

    if (TASK_TOOLS.has(toolLower)) {
      sessionCounters.set(sessionID, 0)
      return
    }

    const currentCount = sessionCounters.get(sessionID) ?? 0
    const newCount = currentCount + 1

    if (newCount >= TURN_THRESHOLD) {
      output.output += REMINDER_MESSAGE
      sessionCounters.set(sessionID, 0)
    } else {
      sessionCounters.set(sessionID, newCount)
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
