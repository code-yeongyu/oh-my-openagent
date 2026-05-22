export {
  AGENT_DISPLAY_NAMES,
  stripInvisibleAgentCharacters,
  stripAgentListSortPrefix,
  getAgentDisplayName,
  getAgentListDisplayName,
  getAgentConfigKey,
  normalizeAgentForPrompt,
  normalizeAgentForPromptKey,
} from "./agent-display-names"

export {
  DEFAULT_AGENT_ORDER,
  validateAgentOrder,
  resolveAgentOrderDisplayNames,
} from "./agent-ordering"
export type { AgentOrderValidation } from "./agent-ordering"

export {
  setAgentSortOrder,
  setDefaultAgentForSort,
  installAgentSortShim,
} from "./agent-sort-shim"
