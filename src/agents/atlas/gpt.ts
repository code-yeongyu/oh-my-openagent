import { buildAtlasPrompt } from "./shared-prompt"
import {
  GPT_ATLAS_INTRO,
  GPT_ATLAS_WORKFLOW,
  GPT_ATLAS_PARALLEL_ADDENDUM,
  GPT_ATLAS_VERIFICATION_RULES,
  GPT_ATLAS_BOUNDARIES,
  GPT_ATLAS_CRITICAL_RULES,
} from "./gpt-prompt-sections"

export const ATLAS_GPT_SYSTEM_PROMPT = buildAtlasPrompt({
  intro: GPT_ATLAS_INTRO,
  workflow: GPT_ATLAS_WORKFLOW,
  parallelAddendum: GPT_ATLAS_PARALLEL_ADDENDUM,
  verificationRules: GPT_ATLAS_VERIFICATION_RULES,
  boundaries: GPT_ATLAS_BOUNDARIES,
  criticalRules: GPT_ATLAS_CRITICAL_RULES,
})

export function getGptAtlasPrompt(): string {
  return ATLAS_GPT_SYSTEM_PROMPT
}
