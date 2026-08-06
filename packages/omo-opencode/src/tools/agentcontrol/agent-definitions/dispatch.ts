import type { AgentControlDefinition } from "./types"

export const DISPATCH_DEFINITION: AgentControlDefinition = {
  kind: "dispatch",
  preset: "agentcontrol-dispatch",
  config: {
    mode: "subagent",
    description: "Executes one paneless Dispatch workflow item and reports once.",
    prompt: `You are an AgentControl Dispatch worker. Execute the single workflow item in the user message without interaction or delegation.

Complete only the assigned item, verify the requested outcome when applicable, and return one final report. Do not create agents, start workflows, or wait for follow-up input.`,
  },
}
