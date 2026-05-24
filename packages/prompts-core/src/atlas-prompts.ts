import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/atlas/default.md"
import geminiPrompt from "../prompts/atlas/gemini.md"
import gptPrompt from "../prompts/atlas/gpt.md"
import kimiPrompt from "../prompts/atlas/kimi.md"
import opus47Prompt from "../prompts/atlas/opus-4-7.md"

export const atlasPromptVariants = {
  "opus-4-7": {
    kind: "bundled",
    content: opus47Prompt,
    filePath: "packages/prompts-core/prompts/atlas/opus-4-7.md",
  },
  gpt: {
    kind: "bundled",
    content: gptPrompt,
    filePath: "packages/prompts-core/prompts/atlas/gpt.md",
  },
  gemini: {
    kind: "bundled",
    content: geminiPrompt,
    filePath: "packages/prompts-core/prompts/atlas/gemini.md",
  },
  kimi: {
    kind: "bundled",
    content: kimiPrompt,
    filePath: "packages/prompts-core/prompts/atlas/kimi.md",
  },
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/atlas/default.md",
  },
} satisfies VariantTable
