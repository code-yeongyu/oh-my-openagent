import { buildAtlasPrompt } from "./shared-prompt"
import {
  OPUS_47_ATLAS_INTRO,
  OPUS_47_ATLAS_WORKFLOW,
  OPUS_47_ATLAS_PARALLEL_ADDENDUM,
  OPUS_47_ATLAS_VERIFICATION_RULES,
  OPUS_47_ATLAS_BOUNDARIES,
  OPUS_47_ATLAS_CRITICAL_RULES,
} from "./opus-4-7-prompt-sections"

export const ATLAS_OPUS_47_SYSTEM_PROMPT = buildAtlasPrompt({
  intro: OPUS_47_ATLAS_INTRO,
  workflow: OPUS_47_ATLAS_WORKFLOW,
  parallelAddendum: OPUS_47_ATLAS_PARALLEL_ADDENDUM,
  verificationRules: OPUS_47_ATLAS_VERIFICATION_RULES,
  boundaries: OPUS_47_ATLAS_BOUNDARIES,
  criticalRules: OPUS_47_ATLAS_CRITICAL_RULES,
})

export function getOpus47AtlasPrompt(): string {
  return ATLAS_OPUS_47_SYSTEM_PROMPT
}
