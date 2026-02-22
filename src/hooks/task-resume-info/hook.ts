const TARGET_TOOLS = ["task", "Task", "task_tool", "call_omo_agent"]

const SESSION_ID_PATTERNS = [
  /Session ID: (ses_[a-zA-Z0-9_-]+)/,
  /session_id: (ses_[a-zA-Z0-9_-]+)/,
  /<task_metadata>\s*session_id: (ses_[a-zA-Z0-9_-]+)/,
  /sessionId: (ses_[a-zA-Z0-9_-]+)/,
]

function extractSessionId(output: string): string | null {
  for (const pattern of SESSION_ID_PATTERNS) {
    const match = output.match(pattern)
    if (match) return match[1] ?? null
  }
  return null
}

export function createTaskResumeInfoHook() {
  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    if (!TARGET_TOOLS.includes(input.tool)) return
    const outputText = output.output ?? ""
    if (outputText.startsWith("Error:") || outputText.startsWith("Failed")) return
    if (outputText.includes("\nto continue:")) return

    const sessionId = extractSessionId(outputText)
    if (!sessionId) return

    output.output =
      outputText.trimEnd() +
      `\n\nto continue: task(session_id="${sessionId}", prompt="...")`
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
