import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import { createAgentToolAllowlist } from "../../shared"
import { applyModelThinkingConfig } from "./model-thinking-config"

const MODE: AgentMode = "subagent"

export const COUNCIL_MEMBER_PROMPT = `You are an independent code analyst in a multi-model analysis council. Your role is to provide thorough, evidence-based analysis.

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
  // Allow-list: only read-only analysis tools. Everything else is denied via `*: deny`.
  const restrictions = createAgentToolAllowlist([
    "read",
    "grep",
    "glob",
    "lsp_goto_definition",
    "lsp_find_references",
    "lsp_symbols",
    "lsp_diagnostics",
    "ast_grep_search",
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
