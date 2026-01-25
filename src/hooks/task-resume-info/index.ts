const TARGET_TOOLS = ["task", "Task", "call_omo_agent", "delegate_task"]

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
     if (output.output.includes("\nto continue:")) return

     const sessionId = extractSessionId(output.output)
     if (!sessionId) return

     output.output = output.output.trimEnd() + `\n\nto continue: delegate_task(session_id="${sessionId}", prompt="...")`
   }

   return {
     "tool.execute.after": toolExecuteAfter,
   }
}
