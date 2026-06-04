import { loadPromptSync, prometheusPromptVariants } from "@oh-my-opencode/prompts-core"

export const PROMETHEUS_GPT_SYSTEM_PROMPT = loadPromptSync({
  source: prometheusPromptVariants.gpt,
  name: "prometheus",
  variant: "gpt",
}).body
