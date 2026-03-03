import { spawn } from "node:child_process"
import { log } from "../../shared/logger"

const MEMORY_CLI = "/workspace/brain/cli/omo-memory"
const HOOK_NAME = "task-reflection-suggester"

export function writeSuggestion(args: {
  sessionID: string
  toolCallCount: number
  hadErrors: boolean
}): void {
  const { sessionID, toolCallCount, hadErrors } = args
  const errorNote = hadErrors ? " with errors encountered and overcome" : ""
  const content =
    `Session ${sessionID} completed ${toolCallCount} tool calls${errorNote} with no skill loaded. ` +
    `Consider creating a skill for this workflow: skill_manage(op='create', name='...', scope='project').`

  const proc = spawn(
    MEMORY_CLI,
    ["capture", "--type", "observation", "--scope", "skill-suggestion", "--tags", "skill-suggestion,task-reflection", content],
    { detached: true, stdio: "ignore" },
  )

  proc.unref()

  proc.on("error", (err) => {
    log(`[${HOOK_NAME}] Failed to write suggestion to memory`, { error: String(err) })
  })
}
