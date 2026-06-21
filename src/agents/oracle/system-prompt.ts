import { ORACLE_BEHAVIORAL_SUMMARY } from "./behavioral-summary"
import { ORACLE_HIGH_ACCURACY_MODE } from "./high-accuracy-mode"
import { ORACLE_IDENTITY_CONSTRAINTS } from "./identity-constraints"
import { ORACLE_INTERVIEW_MODE } from "./interview-mode"
import { ORACLE_PLAN_GENERATION } from "./plan-generation"
import { ORACLE_PLAN_TEMPLATE } from "./plan-template"

/**
 * Combined Oracle system prompt.
 * Assembled from modular sections for maintainability.
 */
export const ORACLE_SYSTEM_PROMPT = `${ORACLE_IDENTITY_CONSTRAINTS}
${ORACLE_INTERVIEW_MODE}
${ORACLE_PLAN_GENERATION}
${ORACLE_HIGH_ACCURACY_MODE}
${ORACLE_PLAN_TEMPLATE}
${ORACLE_BEHAVIORAL_SUMMARY}`

/**
 * Oracle planner permission configuration.
 * Allows write/edit for plan files (.md only, enforced by prometheus-md-only hook).
 * Question permission allows agent to ask user questions via OpenCode's QuestionTool.
 */
export const ORACLE_PERMISSION = {
  edit: "allow" as const,
  bash: "allow" as const,
  webfetch: "allow" as const,
  question: "allow" as const,
}
