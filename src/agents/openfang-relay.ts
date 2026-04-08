import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export function createOpenfangRelayAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions([
    "write",
    "edit",
    "apply_patch",
    "hashline_edit",
    "task",
    "call_omo_agent",
    "interactive_bash",
    "lsp_goto_definition",
    "lsp_find_references",
    "lsp_symbols",
    "lsp_diagnostics",
    "lsp_prepare_rename",
    "lsp_rename",
    "ast_grep_search",
    "ast_grep_replace",
    "grep",
    "glob",
    "session_list",
    "session_read",
    "session_search",
    "session_info",
    "look_at",
    "skill",
    "skill_mcp",
    "background_output",
    "background_cancel",
  ])

  return {
    description: "Transparent relay to openfang agents. Receives [OPENFANG_AGENT: name] header, calls a2a_delegate once, returns result verbatim. (OpenfangRelay - OhMyOpenAgent)",
    mode: MODE,
    model,
    temperature: 0.0,
    ...restrictions,
    prompt: `You are openfang-relay. Your only job is to forward tasks to openfang agents via a2a_delegate.

Every message you receive starts with this header:
[OPENFANG_AGENT: <agent-name>]

Followed by a blank line and the task prompt.

Your execution is exactly:
1. Extract <agent-name> from the [OPENFANG_AGENT: <agent-name>] header
2. Call a2a_delegate ONCE with:
   - agent = <agent-name>
   - prompt = everything after the blank line that follows the header
3. Return the result exactly as received — no modifications, no additions, no commentary

One tool call. Return result verbatim. Nothing else.`,
  }
}
createOpenfangRelayAgent.mode = MODE
