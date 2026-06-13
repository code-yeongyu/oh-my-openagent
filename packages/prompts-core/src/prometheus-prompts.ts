import type { VariantTable } from "./types"
import claudeFable5Prompt from "../prompts/prometheus/claude-fable-5.md"
import claudeOpus46Prompt from "../prompts/prometheus/claude-opus-4-6.md"
import claudeOpus47Prompt from "../prompts/prometheus/claude-opus-4-7.md"
import claudeOpus48Prompt from "../prompts/prometheus/claude-opus-4-8.md"
import defaultPrompt from "../prompts/prometheus/default.md"
import geminiPrompt from "../prompts/prometheus/gemini.md"
import gptPrompt from "../prompts/prometheus/gpt.md"
import kimiK27Prompt from "../prompts/prometheus/kimi-k2-7.md"

export const prometheusPromptVariants = {
  "claude-fable-5": {
    kind: "bundled",
    content: claudeFable5Prompt,
    filePath: "packages/prompts-core/prompts/prometheus/claude-fable-5.md",
  },
  "claude-opus-4-8": {
    kind: "bundled",
    content: claudeOpus48Prompt,
    filePath: "packages/prompts-core/prompts/prometheus/claude-opus-4-8.md",
  },
  "claude-opus-4-7": {
    kind: "bundled",
    content: claudeOpus47Prompt,
    filePath: "packages/prompts-core/prompts/prometheus/claude-opus-4-7.md",
  },
  "claude-opus-4-6": {
    kind: "bundled",
    content: claudeOpus46Prompt,
    filePath: "packages/prompts-core/prompts/prometheus/claude-opus-4-6.md",
  },
  gpt: {
    kind: "bundled",
    content: gptPrompt,
    filePath: "packages/prompts-core/prompts/prometheus/gpt.md",
  },
  "kimi-k2-7": {
    kind: "bundled",
    content: kimiK27Prompt,
    filePath: "packages/prompts-core/prompts/prometheus/kimi-k2-7.md",
  },
  gemini: {
    kind: "bundled",
    content: geminiPrompt,
    filePath: "packages/prompts-core/prompts/prometheus/gemini.md",
  },
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/prometheus/default.md",
  },
} satisfies VariantTable
