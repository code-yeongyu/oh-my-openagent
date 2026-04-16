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

    const sessionId = extractTaskLink(output.metadata, outputText).sessionId
    if (!sessionId) return

    output.output =
      outputText.trimEnd() +
      `\n\nto continue: task(session_id="${sessionId}", load_skills=[], run_in_background=false, prompt="...")`
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
