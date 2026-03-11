/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

import {
  ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX,
  COUNCIL_MEMBER_KEY_PREFIX,
} from "../agents/builtin-agents/council-member-agents"

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  call_omo_agent: false,
  switch_agent: false,
}

const COUNCIL_MEMBER_DELEGATION_RESTRICTIONS: Record<string, boolean> = {
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
  background_wait: true,
  background_cancel: true,
  todowrite: false,
  todoread: false,
}

const COUNCIL_MEMBER_SOLO_RESTRICTIONS: Record<string, boolean> = {
  "*": false,
  finish_task: true,
  background_wait: true,
  read: true,
  grep: true,
  glob: true,
  lsp_goto_definition: true,
  lsp_find_references: true,
  lsp_symbols: true,
  lsp_diagnostics: true,
  ast_grep_search: true,
  call_omo_agent: false,
  background_output: false,
  background_cancel: false,
  todowrite: false,
  todoread: false,
}

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: false,
    edit: false,
    task: false,
    call_omo_agent: false,
    switch_agent: false,
  },

  metis: {
    write: false,
    edit: false,
    task: false,
    switch_agent: false,
  },

  momus: {
    write: false,
    edit: false,
    task: false,
    switch_agent: false,
  },

  "multimodal-looker": {
    read: true,
  },

  "sisyphus-junior": {
    task: false,
    switch_agent: false,
  },

  athena: {
    call_omo_agent: false,
  },

  "athena-junior": {
    call_omo_agent: false,
    question: false,
    switch_agent: false,
  },

  // NOTE: Athena/council tool restrictions are also defined in:
  // - src/agents/athena/agent.ts (AgentConfig permission format)
  // - src/agents/athena/council-member-agent.ts (AgentConfig tools + permission)
  // - src/plugin-handlers/tool-config-handler.ts (allow/deny string format)
  // Keep all three in sync when modifying.
  "council-member": COUNCIL_MEMBER_DELEGATION_RESTRICTIONS,
  "athena-junior-council-member": COUNCIL_MEMBER_SOLO_RESTRICTIONS,
}

export function getAgentToolRestrictions(agentName: string): Record<string, boolean> {
  if (agentName.startsWith(ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX)) {
    return AGENT_RESTRICTIONS["athena-junior-council-member"] ?? {}
  }

  if (agentName.startsWith(COUNCIL_MEMBER_KEY_PREFIX)) {
    return AGENT_RESTRICTIONS["council-member"] ?? {}
  }

  return AGENT_RESTRICTIONS[agentName]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    ?? {}
}


