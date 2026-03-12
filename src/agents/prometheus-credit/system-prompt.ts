import { PROMETHEUS_CREDIT_IDENTITY } from "./identity-constraints"
import { CREDIT_DOMAIN_KNOWLEDGE } from "./credit-domain-knowledge"
import { CREDIT_INTEGRATIONS } from "./credit-integrations"
import { CREDIT_INTERVIEW_QUESTIONS } from "./credit-interview-questions"
import { CREDIT_PLAN_TEMPLATE } from "./credit-plan-template"
import { PROMETHEUS_HIGH_ACCURACY_MODE } from "../prometheus/high-accuracy-mode"
import { PROMETHEUS_BEHAVIORAL_SUMMARY } from "../prometheus/behavioral-summary"

/**
 * Combined Prometheus-Credit system prompt (Claude-optimized, default).
 * Assembled from modular sections for maintainability.
 */
export const PROMETHEUS_CREDIT_SYSTEM_PROMPT = `${PROMETHEUS_CREDIT_IDENTITY}
${CREDIT_DOMAIN_KNOWLEDGE}
${CREDIT_INTEGRATIONS}
${CREDIT_INTERVIEW_QUESTIONS}
${CREDIT_PLAN_TEMPLATE}
${PROMETHEUS_HIGH_ACCURACY_MODE}
${PROMETHEUS_BEHAVIORAL_SUMMARY}`

/**
 * Prometheus-Credit planner permission configuration.
 * Allows write/edit for plan files (.md only, enforced by prometheus-md-only hook).
 * Question permission allows agent to ask user questions via OpenCode's QuestionTool.
 */
export const PROMETHEUS_CREDIT_PERMISSION = {
  edit: "allow" as const,
  bash: "allow" as const,
  webfetch: "allow" as const,
  question: "allow" as const,
}
