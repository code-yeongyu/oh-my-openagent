import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"

const MODE: AgentMode = "subagent"

const COUNCIL_MEMBER_PROMPT =
  "You are an independent code analyst in a multi-model council. Provide thorough, evidence-based analysis."

export function createCouncilMemberAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "task",
    "call_omo_agent",
    "athena_council",
  ])

  return {
    description: "Independent code analyst for Athena multi-model council. Read-only, evidence-based analysis. (Council Member - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    prompt: COUNCIL_MEMBER_PROMPT,
    ...restrictions,
  } as AgentConfig
}
createCouncilMemberAgent.mode = MODE
