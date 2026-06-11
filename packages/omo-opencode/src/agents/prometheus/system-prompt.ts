import { loadPromptSync, prometheusPromptVariants } from "@oh-my-opencode/prompts-core"
import {
  isClaudeFable5Model,
  isClaudeOpus46Model,
  isClaudeOpus47Model,
  isClaudeOpus48Model,
  isGeminiModel,
  isGptModel,
} from "../types"

export type PrometheusPromptSource =
  | "default"
  | "gpt"
  | "gemini"
  | "claude-fable-5"
  | "claude-opus-4-8"
  | "claude-opus-4-7"
  | "claude-opus-4-6"

export const PROMETHEUS_PERMISSION = {
  edit: "allow" as const,
  bash: "allow" as const,
  webfetch: "allow" as const,
  question: "allow" as const,
}

const QUESTION_TOOL_BLOCK_RE = /```typescript\r?\n\s*Question\(\{[\s\S]*?\}\)\s*\r?\n```/g

function loadPrometheusVariant(variant: PrometheusPromptSource): string {
  return loadPromptSync({
    source: prometheusPromptVariants[variant],
    name: "prometheus",
    variant,
  }).body
}

export const PROMETHEUS_SYSTEM_PROMPT = loadPrometheusVariant("default")

export function getPrometheusPromptSource(model?: string): PrometheusPromptSource {
  if (!model) return "default"
  if (isClaudeFable5Model(model)) return "claude-fable-5"
  if (isClaudeOpus48Model(model)) return "claude-opus-4-8"
  if (isClaudeOpus47Model(model)) return "claude-opus-4-7"
  if (isClaudeOpus46Model(model)) return "claude-opus-4-6"
  if (isGptModel(model)) return "gpt"
  if (isGeminiModel(model)) return "gemini"
  return "default"
}

export function getPrometheusPrompt(model?: string, disabledTools?: readonly string[]): string {
  const variant = getPrometheusPromptSource(model)
  const body = loadPrometheusVariant(variant)
  return disabledTools?.includes("question") ? body.replace(QUESTION_TOOL_BLOCK_RE, "") : body
}
