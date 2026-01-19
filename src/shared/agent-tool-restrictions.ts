/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 *
 * MCP tools use wildcards: "mcp-server-name_*": true enables all tools from that MCP.
 */

/**
 * Context-Engine MCP tools - enabled for agents that benefit from semantic code search.
 * Uses wildcard to enable all context-engine tools (repo_search, symbol_graph, etc.)
 */
const CONTEXT_ENGINE_MCP_TOOLS: Record<string, boolean> = {
  "context-engine_*": true,
};

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  delegate_task: false,
  call_omo_agent: false,
};

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: {
    ...EXPLORATION_AGENT_DENYLIST,
    ...CONTEXT_ENGINE_MCP_TOOLS,
  },

  librarian: {
    ...EXPLORATION_AGENT_DENYLIST,
    ...CONTEXT_ENGINE_MCP_TOOLS,
  },

  oracle: {
    write: false,
    edit: false,
    task: false,
    delegate_task: false,
    ...CONTEXT_ENGINE_MCP_TOOLS,
  },

  "multimodal-looker": {
    read: true,
  },

  "document-writer": {
    task: false,
    delegate_task: false,
    call_omo_agent: false,
    ...CONTEXT_ENGINE_MCP_TOOLS,
  },

  "frontend-ui-ux-engineer": {
    task: false,
    delegate_task: false,
    call_omo_agent: false,
    ...CONTEXT_ENGINE_MCP_TOOLS,
  },

  "Sisyphus-Junior": {
    task: false,
    delegate_task: false,
    ...CONTEXT_ENGINE_MCP_TOOLS,
  },

  "sisyphus-junior": {
    task: false,
    delegate_task: false,
    ...CONTEXT_ENGINE_MCP_TOOLS,
  },

  general: {
    ...CONTEXT_ENGINE_MCP_TOOLS,
  },
};

export function getAgentToolRestrictions(
  agentName: string,
): Record<string, boolean> {
  return AGENT_RESTRICTIONS[agentName] ?? {};
}

/**
 * Get context-engine MCP tool restrictions.
 * Can be used to add context-engine tools to custom agent configurations.
 */
export function getContextEngineMcpTools(): Record<string, boolean> {
  return { ...CONTEXT_ENGINE_MCP_TOOLS };
}

export function hasAgentToolRestrictions(agentName: string): boolean {
  const restrictions = AGENT_RESTRICTIONS[agentName];
  return restrictions !== undefined && Object.keys(restrictions).length > 0;
}
