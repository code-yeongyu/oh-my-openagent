import { loadPromptSync, prometheusPromptVariants } from "@oh-my-opencode/prompts-core"
import { isGptModel, isGeminiModel } from "../types"

export type PrometheusPromptSource = "default" | "gpt" | "gemini"

export const PROMETHEUS_PERMISSION = {
  edit: "allow" as const,
  bash: "allow" as const,
  webfetch: "allow" as const,
  question: "allow" as const,
}

const QUESTION_TOOL_BLOCK_RE = /```typescript\n\s*Question\(\{[\s\S]*?\}\)\s*\n```/g

function loadPrometheusVariant(variant: PrometheusPromptSource): string {
  return loadPromptSync({
    source: prometheusPromptVariants[variant],
    name: "prometheus",
    variant,
  }).body
}

export const PROMETHEUS_SYSTEM_PROMPT = loadPrometheusVariant("default")

export function getPrometheusPromptSource(model?: string): PrometheusPromptSource {
  if (model && isGptModel(model)) return "gpt"
  if (model && isGeminiModel(model)) return "gemini"
  return "default"
}

export function getPrometheusPrompt(model?: string, disabledTools?: readonly string[]): string {
  const variant = getPrometheusPromptSource(model)
  const body = loadPrometheusVariant(variant)
  return disabledTools?.includes("question") ? body.replace(QUESTION_TOOL_BLOCK_RE, "") : body
}
