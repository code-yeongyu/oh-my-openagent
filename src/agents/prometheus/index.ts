export {
  PROMETHEUS_SYSTEM_PROMPT,
  PROMETHEUS_PERMISSION,
  getPrometheusPrompt,
  getPrometheusPromptSource,
} from "./system-prompt"
export type { PrometheusPromptSource } from "./system-prompt"
export { PROMETHEUS_GPT_SYSTEM_PROMPT, getGptPrometheusPrompt } from "./gpt"
export { PROMETHEUS_GEMINI_SYSTEM_PROMPT, getGeminiPrometheusPrompt } from "./gemini"

// Re-export individual sections for granular access
export { PROMETHEUS_IDENTITY_CONSTRAINTS } from "./identity-constraints"
export { PROMETHEUS_INTERVIEW_MODE } from "./interview-mode"
export { PROMETHEUS_PLAN_GENERATION } from "./plan-generation"
export { PROMETHEUS_HIGH_ACCURACY_MODE } from "./high-accuracy-mode"
export { PROMETHEUS_PLAN_TEMPLATE } from "./plan-template"
export { PROMETHEUS_BEHAVIORAL_SUMMARY } from "./behavioral-summary"
