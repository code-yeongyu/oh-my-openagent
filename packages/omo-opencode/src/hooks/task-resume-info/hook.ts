import { extractTaskLink } from "../../features/tool-metadata-store"

const TARGET_TOOLS = ["task", "Task", "task_tool", "call_omo_agent"]

export function createTaskResumeInfoHook() {
  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    if (!TARGET_TOOLS.includes(input.tool)) return
    const outputText = output.output ?? ""
    if (outputText.startsWith("Error:") || outputText.startsWith("Failed")) return
    if (outputText.includes("\nto continue:")) return

    const link = extractTaskLink(output.metadata, outputText)
    const taskId = link.taskId ?? link.sessionId
    if (!taskId) return

    output.output =
      outputText.trimEnd() +
      `\n\nto continue: task(task_id="${taskId}", load_skills=[], run_in_background=false, prompt="...")`
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
