import { buildAtlasPrompt } from "./shared-prompt"
import {
  QWEN_ATLAS_INTRO,
  QWEN_ATLAS_WORKFLOW,
  QWEN_ATLAS_PARALLEL_EXECUTION,
  QWEN_ATLAS_VERIFICATION_RULES,
  QWEN_ATLAS_BOUNDARIES,
  QWEN_ATLAS_CRITICAL_RULES,
} from "./qwen-prompt-sections"

export const ATLAS_QWEN_SYSTEM_PROMPT = buildAtlasPrompt({
  intro: QWEN_ATLAS_INTRO,
  workflow: QWEN_ATLAS_WORKFLOW,
  parallelExecution: QWEN_ATLAS_PARALLEL_EXECUTION,
  verificationRules: QWEN_ATLAS_VERIFICATION_RULES,
  boundaries: QWEN_ATLAS_BOUNDARIES,
  criticalRules: QWEN_ATLAS_CRITICAL_RULES,
})

export function getQwenAtlasPrompt(): string {
  return ATLAS_QWEN_SYSTEM_PROMPT
}