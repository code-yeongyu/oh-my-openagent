import { loadPromptSync, prometheusPromptVariants } from "@oh-my-opencode/prompts-core"
import { buildNativeAgentPrompt } from "../native-model-prompt"

export const PROMETHEUS_PERMISSION = {
  edit: "allow" as const,
  bash: "allow" as const,
  webfetch: "allow" as const,
  question: "allow" as const,
}

function loadDefaultPrometheusPrompt(): string {
  return loadPromptSync({
    source: prometheusPromptVariants.default,
    name: "prometheus",
    variant: "default",
  }).body
}

export const PROMETHEUS_SYSTEM_PROMPT = loadDefaultPrometheusPrompt()

export function getPrometheusPrompt(model?: string, disabledTools?: readonly string[]): string {
  const tools = ["read", "grep", "glob", "bash", "edit", "write", "question", "skill"]
    .filter((name) => !disabledTools?.includes(name))
  return buildNativeAgentPrompt(model, PROMETHEUS_SYSTEM_PROMPT, tools)
}
