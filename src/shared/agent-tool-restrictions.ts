/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

import { COUNCIL_MEMBER_KEY_PREFIX } from "../agents/builtin-agents/council-member-agents"

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  call_omo_agent: false,
}

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: false,
    edit: false,
    task: false,
    call_omo_agent: false,
  },

  metis: {
    write: false,
    edit: false,
    task: false,
  },

  momus: {
    write: false,
    edit: false,
    task: false,
  },

  "multimodal-looker": {
    read: true,
  },

  "sisyphus-junior": {
    task: false,
  },

  athena: {
    write: false,
    edit: false,
    call_omo_agent: false,
  },

  // NOTE: Athena/council tool restrictions are also defined in:
  // - src/agents/athena/agent.ts (AgentConfig permission format)
  // - src/agents/athena/council-member-agent.ts (AgentConfig permission format — allow-list)
  // - src/plugin-handlers/tool-config-handler.ts (allow/deny string format)
  // Keep all three in sync when modifying.
  // Council members use an allow-list: read-only analysis + optional call_omo_agent delegation.
  // TodoWrite/TodoRead explicitly denied to prevent uncompletable todo loops.
  // Prompt file lives in .sisyphus/tmp/ (inside project) so no external_directory needed.
  "council-member": {
    "*": false,
    read: true,
    grep: true,
    glob: true,
    lsp_goto_definition: true,
    lsp_find_references: true,
    lsp_symbols: true,
    lsp_diagnostics: true,
    ast_grep_search: true,
    call_omo_agent: true,
    background_output: true,
    todowrite: false,
    todoread: false,
  },
}

export function getAgentToolRestrictions(agentName: string): Record<string, boolean> {
  if (agentName.startsWith(COUNCIL_MEMBER_KEY_PREFIX)) {
    return AGENT_RESTRICTIONS["council-member"] ?? {}
  }

  return AGENT_RESTRICTIONS[agentName]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    ?? {}
}


