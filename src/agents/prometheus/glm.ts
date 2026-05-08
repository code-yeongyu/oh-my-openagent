import { PROMETHEUS_SYSTEM_PROMPT } from "./system-prompt"
import { buildGlmVisionHardBlock } from "../sisyphus/glm"

export function getGlmPrometheusPrompt(): string {
  return `${PROMETHEUS_SYSTEM_PROMPT}

${buildGlmVisionHardBlock()}`
}
