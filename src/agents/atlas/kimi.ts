import { buildAtlasPrompt } from "./shared-prompt"
import {
  KIMI_ATLAS_INTRO,
  KIMI_ATLAS_WORKFLOW,
  KIMI_ATLAS_PARALLEL_ADDENDUM,
  KIMI_ATLAS_VERIFICATION_RULES,
  KIMI_ATLAS_BOUNDARIES,
  KIMI_ATLAS_CRITICAL_RULES,
} from "./kimi-prompt-sections"

export const ATLAS_KIMI_SYSTEM_PROMPT = buildAtlasPrompt({
  intro: KIMI_ATLAS_INTRO,
  workflow: KIMI_ATLAS_WORKFLOW,
  parallelAddendum: KIMI_ATLAS_PARALLEL_ADDENDUM,
  verificationRules: KIMI_ATLAS_VERIFICATION_RULES,
  boundaries: KIMI_ATLAS_BOUNDARIES,
  criticalRules: KIMI_ATLAS_CRITICAL_RULES,
})

export function getKimiAtlasPrompt(): string {
  return ATLAS_KIMI_SYSTEM_PROMPT
}
