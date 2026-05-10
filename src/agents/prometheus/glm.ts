import { PROMETHEUS_SYSTEM_PROMPT } from "./system-prompt"
import { buildGlmVisionHardBlock, buildGlmLanguageConstraint } from "../sisyphus/glm"

export function getGlmPrometheusPrompt(): string {
  return `${PROMETHEUS_SYSTEM_PROMPT}

${buildGlmVisionHardBlock()}

${buildGlmLanguageConstraint()}`
}
