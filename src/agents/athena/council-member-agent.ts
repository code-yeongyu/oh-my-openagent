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
5. Be concise but thorough — quality over quantity

## CRITICAL: Do NOT use TodoWrite
- Do NOT create todos or task lists
- Do NOT use the TodoWrite tool under any circumstances
- Simply report your findings directly in your response`

export const COUNCIL_DELEGATION_ADDENDUM = `
## Delegation Mode
You can delegate heavy exploration to specialized agents using call_omo_agent:
- Use \`call_omo_agent(subagent_type="explore", ...)\` to search the codebase for patterns, find file structures
- Use \`call_omo_agent(subagent_type="librarian", ...)\` for documentation lookups and external references
- Always set \`run_in_background=true\` and collect results with \`background_output\`
- Delegate broad searches, keep targeted reads for yourself
- This saves your context window for analysis rather than exploration`

export function createCouncilMemberAgent(model: string): AgentConfig {
  // Allow-list: only read-only analysis tools + optional delegation.
  // Everything else is denied via `*: deny`.
  // TodoWrite/TodoRead explicitly denied to prevent uncompletable todo loops.
  const restrictions = createAgentToolAllowlist([
    "read",
    "grep",
    "glob",
    "lsp_goto_definition",
    "lsp_find_references",
    "lsp_symbols",
    "lsp_diagnostics",
    "ast_grep_search",
    "call_omo_agent",
    "background_output",
  ])

  // Explicitly deny TodoWrite/TodoRead even though `*: deny` should catch them.
  // Built-in OpenCode tools may bypass the wildcard deny.
  restrictions.permission.todowrite = "deny"
  restrictions.permission.todoread = "deny"

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
