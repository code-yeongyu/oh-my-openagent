export { ATLAS_SYSTEM_PROMPT, getDefaultAtlasPrompt } from "./default"
export { ATLAS_GPT_SYSTEM_PROMPT, getGptAtlasPrompt } from "./gpt"
export {
  getCategoryDescription,
  buildAgentSelectionSection,
  buildCategorySection,
  buildSkillsSection,
  buildDecisionMatrix,
} from "./prompt-section-builder"

export { createAtlasAgent, getAtlasPromptSource, getAtlasPrompt, atlasPromptMetadata } from "./agent"
export type { AtlasPromptSource, OrchestratorContext } from "./agent"

export { isGptModel } from "../types"
