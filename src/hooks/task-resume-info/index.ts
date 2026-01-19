const TARGET_TOOLS = ["task", "Task", "call_omo_agent"]

const SESSION_ID_PATTERNS = [
  /Session ID: (ses_[a-zA-Z0-9_-]+)/,
  /session_id: (ses_[a-zA-Z0-9_-]+)/,
  /<task_metadata>\s*session_id: (ses_[a-zA-Z0-9_-]+)/,
  /sessionId: (ses_[a-zA-Z0-9_-]+)/,
]

function extractSessionId(output: string): string | null {
  for (const pattern of SESSION_ID_PATTERNS) {
    const match = output.match(pattern)
    if (match) return match[1]
  }
  return null
}

export function createTaskResumeInfoHook() {
  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    if (!TARGET_TOOLS.includes(input.tool)) return
    if (output.output.startsWith("Error:") || output.output.startsWith("Failed")) return
    if (output.output.includes("\nto resume:")) return

    const sessionId = extractSessionId(output.output)
    if (!sessionId) return

    const toolName = input.tool.toLowerCase()
    if (toolName === "call_omo_agent") {
      output.output =
        output.output.trimEnd() +
        `\n\nto resume: call_omo_agent(session_id="${sessionId}", run_in_background=false, subagent_type="<same as before>", description="...", prompt="...")`
      return
    }

    output.output =
      output.output.trimEnd() +
      `\n\nto resume: task(session_id="${sessionId}", subagent_type="<same as before>", description="...", prompt="...")`
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
