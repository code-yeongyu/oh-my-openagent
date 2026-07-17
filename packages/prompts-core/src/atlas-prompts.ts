import type { VariantTable } from "./types"
import defaultPrompt from "../prompts/atlas/default.md"
import geminiPrompt from "../prompts/atlas/gemini.md"
import glmPrompt from "../prompts/atlas/glm.md"
import gptPrompt from "../prompts/atlas/gpt.md"
import kimiPrompt from "../prompts/atlas/kimi.md"
import kimiK27Prompt from "../prompts/atlas/kimi-k2-7.md"
import kimiK3Prompt from "../prompts/atlas/kimi-k3.md"
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
  "kimi-k3": {
    kind: "bundled",
    content: kimiK3Prompt,
    filePath: "packages/prompts-core/prompts/atlas/kimi-k3.md",
  },
  "kimi-k2-7": {
    kind: "bundled",
    content: kimiK27Prompt,
    filePath: "packages/prompts-core/prompts/atlas/kimi-k2-7.md",
  },
  kimi: {
    kind: "bundled",
    content: kimiPrompt,
    filePath: "packages/prompts-core/prompts/atlas/kimi.md",
  },
  glm: {
    kind: "bundled",
    content: glmPrompt,
    filePath: "packages/prompts-core/prompts/atlas/glm.md",
  },
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/atlas/default.md",
  },
} satisfies VariantTable
