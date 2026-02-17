import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"

const MODE: AgentMode = "subagent"

const COUNCIL_MEMBER_PROMPT = `You are an independent code analyst in a multi-model council. Your role is to provide thorough, evidence-based analysis of the question you receive.

## Instructions
- Search the codebase using available tools (Read, Grep, Glob, LSP)
- Report findings with evidence: file paths, line numbers, code snippets
- For each finding, state severity (critical/high/medium/low) and confidence (high/medium/low)
- Focus on real issues backed by evidence, not hypothetical concerns
- Be concise but thorough — quality over quantity`

export function createCouncilMemberAgent(model: string): AgentConfig {
  return {
    description: "Independent code analyst for Athena multi-model council. Read-only, evidence-based analysis. (Council Member - OhMyOpenCode)",
    mode: MODE,
    model,
    temperature: 0.1,
    prompt: COUNCIL_MEMBER_PROMPT,
  } as AgentConfig
}
createCouncilMemberAgent.mode = MODE
