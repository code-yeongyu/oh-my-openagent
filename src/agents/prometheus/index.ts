/**
 * Prometheus Planner System Prompt
 *
 * Named after the Titan who gave fire (knowledge/foresight) to humanity.
 * Prometheus operates in INTERVIEW/CONSULTANT mode by default:
 * - Interviews user to understand what they want to build
 * - Uses librarian/explore agents to gather context and make informed suggestions
 * - Provides recommendations and asks clarifying questions
 * - ONLY generates work plan when user explicitly requests it
 *
 * Transition to PLAN GENERATION mode when:
 * - User says "Make it into a work plan!" or "Save it as a file"
 * - Before generating, consults Metis for missed questions/guardrails
 * - Optionally loops through Momus for high-accuracy validation
 *
 * Can write .md files only (enforced by prometheus-md-only hook).
 */

import { PROMETHEUS_IDENTITY_CONSTRAINTS } from "./identity-constraints"
import { PROMETHEUS_INTERVIEW_MODE } from "./interview-mode"
import { PROMETHEUS_PLAN_GENERATION } from "./plan-generation"
import { PROMETHEUS_HIGH_ACCURACY_MODE } from "./high-accuracy-mode"
import { PROMETHEUS_PLAN_TEMPLATE } from "./plan-template"
import { PROMETHEUS_BEHAVIORAL_SUMMARY } from "./behavioral-summary"

/**
 * Combined Prometheus system prompt.
 * Assembled from modular sections for maintainability.
 */
export const PROMETHEUS_SYSTEM_PROMPT = `${PROMETHEUS_IDENTITY_CONSTRAINTS}
${PROMETHEUS_INTERVIEW_MODE}
${PROMETHEUS_PLAN_GENERATION}
${PROMETHEUS_HIGH_ACCURACY_MODE}
${PROMETHEUS_PLAN_TEMPLATE}
${PROMETHEUS_BEHAVIORAL_SUMMARY}`

/**
 * Prometheus planner permission configuration.
 * Allows write/edit for plan files (.md only, enforced by prometheus-md-only hook).
 * Question permission allows agent to ask user questions via OpenCode's QuestionTool.
 */
export const PROMETHEUS_PERMISSION = {
  edit: "allow" as const,
  bash: "allow" as const,
  webfetch: "allow" as const,
  question: "allow" as const,
}

// Re-export individual sections for granular access
export { PROMETHEUS_IDENTITY_CONSTRAINTS } from "./identity-constraints"
export { PROMETHEUS_INTERVIEW_MODE } from "./interview-mode"
export { PROMETHEUS_PLAN_GENERATION } from "./plan-generation"
export { PROMETHEUS_HIGH_ACCURACY_MODE } from "./high-accuracy-mode"
export { PROMETHEUS_PLAN_TEMPLATE } from "./plan-template"
export { PROMETHEUS_BEHAVIORAL_SUMMARY } from "./behavioral-summary"
