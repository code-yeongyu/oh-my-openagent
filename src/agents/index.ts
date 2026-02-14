export * from "./types"
export { createBuiltinAgents } from "./builtin-agents"
export type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-builder"
export { createMorpheusAgent } from "./morpheus"
export { createOracleAgent, ORACLE_PROMPT_METADATA } from "./merovingian"
export { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./operator"
export { createExploreAgent, EXPLORE_PROMPT_METADATA } from "./trinity"


export { createMultimodalLookerAgent, MULTIMODAL_LOOKER_PROMPT_METADATA } from "./construct"
export { createSeraphAgent, SERAPH_SYSTEM_PROMPT, seraphPromptMetadata } from "./seraph"
export { createSmithAgent, SMITH_SYSTEM_PROMPT, smithPromptMetadata } from "./smith"
export { createAtlasAgent, atlasPromptMetadata } from "./architect"
export {
  ORACLE_SYSTEM_PROMPT,
  ORACLE_PERMISSION,
  ORACLE_IDENTITY_CONSTRAINTS,
  ORACLE_INTERVIEW_MODE,
  ORACLE_PLAN_GENERATION,
  ORACLE_HIGH_ACCURACY_MODE,
  ORACLE_PLAN_TEMPLATE,
  ORACLE_BEHAVIORAL_SUMMARY,
} from "./oracle"
