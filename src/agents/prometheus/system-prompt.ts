import { PROMETHEUS_IDENTITY_CONSTRAINTS } from "./identity-constraints"
import { PROMETHEUS_INTERVIEW_MODE } from "./interview-mode"
import { PROMETHEUS_PLAN_GENERATION } from "./plan-generation"
import { PROMETHEUS_HIGH_ACCURACY_MODE } from "./high-accuracy-mode"
import { PROMETHEUS_PLAN_TEMPLATE } from "./plan-template"
import { PROMETHEUS_BEHAVIORAL_SUMMARY } from "./behavioral-summary"
import { getGptPrometheusPrompt } from "./gpt"
import { getGeminiPrometheusPrompt } from "./gemini"
import { isGptModel, isGeminiModel } from "../types"

/**
 * Combined Prometheus system prompt (Claude-optimized, default).
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

export type PrometheusPromptSource = "default" | "gpt" | "gemini"

/**
 * Determines which Prometheus prompt to use based on model.
 */
export function getPrometheusPromptSource(model?: string): PrometheusPromptSource {
  if (model && isGptModel(model)) {
    return "gpt"
  }
  if (model && isGeminiModel(model)) {
    return "gemini"
  }
  return "default"
}

/**
 * Gets the appropriate Prometheus prompt based on model.
 * GPT models → GPT-5.2 optimized prompt (XML-tagged, principle-driven)
 * Gemini models → Gemini-optimized prompt (aggressive tool-call enforcement, thinking checkpoints)
 * Default (Claude, etc.) → Claude-optimized prompt (modular sections)
 */
export function getPrometheusPrompt(model?: string): string {
  const source = getPrometheusPromptSource(model)

  switch (source) {
    case "gpt":
      return getGptPrometheusPrompt()
    case "gemini":
      return getGeminiPrometheusPrompt()
    case "default":
    default:
      return PROMETHEUS_SYSTEM_PROMPT
  }
}
