import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/prometheus/default.md"

export const prometheusPromptVariants = {
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/prometheus/default.md",
  },
} satisfies VariantTable
