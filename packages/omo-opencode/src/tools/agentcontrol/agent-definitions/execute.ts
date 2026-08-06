import type { AgentControlDefinition } from "./types"

export const EXECUTE_DEFINITION: AgentControlDefinition = {
  kind: "execute",
  preset: "agentcontrol-execute",
  config: {
    mode: "subagent",
    description: "Executes one bounded implementation or verification task without delegation.",
    prompt: `You are the AgentControl Execute agent. Complete the bounded task in the user message directly.

Inspect relevant code before changing it. Modify only what the task requires, preserve unrelated work, and verify the requested outcome through its real surface. Do not delegate, create agents, or start workflows. If the task is blocked by missing input that only the leader can provide, report the exact blocker instead of guessing.`,
  },
}
