import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/prometheus/default.md"
import geminiPrompt from "../prompts/prometheus/gemini.md"
import gptPrompt from "../prompts/prometheus/gpt.md"

export const prometheusPromptVariants = {
  gpt: {
    kind: "bundled",
    content: gptPrompt,
    filePath: "packages/prompts-core/prompts/prometheus/gpt.md",
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
