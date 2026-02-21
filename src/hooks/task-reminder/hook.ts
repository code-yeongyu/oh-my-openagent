import type { PluginInput } from "@opencode-ai/plugin"

const TASK_TOOLS = new Set([
  "task",
  "task_create",
  "task_list",
  "task_get",
  "task_update",
  "task_delete",
])
const TURN_THRESHOLD = 10
const REMINDER_MESSAGE = `

The task tools haven't been used recently. If you're tracking work, use task with action=create/update (or task_create/task_update) to record progress.`

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
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.deleted") return
      const props = event.properties as { info?: { id?: string } } | undefined
      const sessionId = props?.info?.id
      if (!sessionId) return
      sessionCounters.delete(sessionId)
    },
  }
}
