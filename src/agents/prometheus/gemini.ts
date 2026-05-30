import { loadPromptSync, prometheusPromptVariants } from "@oh-my-opencode/prompts-core"

export const PROMETHEUS_GEMINI_SYSTEM_PROMPT = loadPromptSync({
  source: prometheusPromptVariants.gemini,
  name: "prometheus",
  variant: "gemini",
}).body
