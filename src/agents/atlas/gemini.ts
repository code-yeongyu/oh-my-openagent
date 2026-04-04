import { buildAtlasPrompt } from "./shared-prompt"
import {
  GEMINI_ATLAS_INTRO,
  GEMINI_ATLAS_WORKFLOW,
  GEMINI_ATLAS_PARALLEL_EXECUTION,
  GEMINI_ATLAS_VERIFICATION_RULES,
  GEMINI_ATLAS_BOUNDARIES,
  GEMINI_ATLAS_CRITICAL_RULES,
} from "./gemini-prompt-sections"

export const ATLAS_GEMINI_SYSTEM_PROMPT = buildAtlasPrompt({
  intro: GEMINI_ATLAS_INTRO,
  workflow: GEMINI_ATLAS_WORKFLOW,
  parallelExecution: GEMINI_ATLAS_PARALLEL_EXECUTION,
  verificationRules: GEMINI_ATLAS_VERIFICATION_RULES,
  boundaries: GEMINI_ATLAS_BOUNDARIES,
  criticalRules: GEMINI_ATLAS_CRITICAL_RULES,
})

export function getGeminiAtlasPrompt(): string {
  return ATLAS_GEMINI_SYSTEM_PROMPT
}
