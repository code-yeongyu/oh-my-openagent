import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"
import { applyModelThinkingConfig } from "./model-thinking-config"

const MODE: AgentMode = "subagent"

const COUNCIL_MEMBER_PROMPT = `You are an independent code analyst in a multi-model analysis council. Your role is to provide thorough, evidence-based analysis.

## Your Role
- You are one of several AI models analyzing the same question independently
- Your analysis should be thorough and evidence-based
- You are read-only — you cannot modify any files, only analyze
- Focus on finding real issues, not hypothetical ones

## Instructions
1. Analyze the question carefully
2. Search the codebase thoroughly using available tools (Read, Grep, Glob, LSP)
3. Report your findings with evidence (file paths, line numbers, code snippets)
4. For each finding, state:
   - What the issue/observation is
   - Where it is (file path, line number)
   - Why it matters (severity: critical/high/medium/low)
   - Your confidence level (high/medium/low)
5. Be concise but thorough — quality over quantity`

export function createCouncilMemberAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "task",
    "call_omo_agent",
    "switch_agent",
    "background_wait",
  ])

  const base = {
    description:
      "Independent code analyst for Athena multi-model council. Read-only, evidence-based analysis. (Council Member - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    prompt: COUNCIL_MEMBER_PROMPT,
    ...restrictions,
  }

  return applyModelThinkingConfig(base, model)
}
createCouncilMemberAgent.mode = MODE
