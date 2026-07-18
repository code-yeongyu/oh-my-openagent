export type SubagentPromptInput = {
  readonly taskId: string
  readonly parentSessionId: string
  readonly rootSessionId: string
  readonly depth: number
  readonly agentType?: string
  readonly instructions?: string
  readonly prompt: string
}

// Task envelope shape mirrors pi-task's buildSubagentPrompt: identity + ancestry lines,
// then the agent/category instructions, then the task text.
export function buildSubagentPrompt(input: SubagentPromptInput): string {
  const lines = [
    `You are running as an omo senpi-task child${input.agentType ? ` "${input.agentType}"` : ""}.`,
    `Task id: ${input.taskId}.`,
    `Parent session: ${input.parentSessionId}.`,
    `Root session: ${input.rootSessionId}.`,
    `Depth: ${input.depth}.`,
  ]
  if (input.instructions && input.instructions.trim().length > 0) {
    lines.push("", "Instructions:", input.instructions.trim())
  }
  lines.push("", "Task:", input.prompt)
  return lines.join("\n")
}
