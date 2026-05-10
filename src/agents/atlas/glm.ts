import { ATLAS_SYSTEM_PROMPT } from "./default"
import { buildGlmVisionHardBlock, buildGlmLanguageConstraint } from "../sisyphus/glm"

export function getGlmAtlasPrompt(): string {
  return `${ATLAS_SYSTEM_PROMPT}

${buildGlmVisionHardBlock()}

${buildGlmLanguageConstraint()}`
}
