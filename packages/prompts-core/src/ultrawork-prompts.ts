import type { VariantTable } from "./types"
import codexPrompt from "../prompts/ultrawork/codex.md"
import defaultPrompt from "../prompts/ultrawork/default.md"
import geminiPrompt from "../prompts/ultrawork/gemini.md"
import gptPrompt from "../prompts/ultrawork/gpt.md"
import plannerPrompt from "../prompts/ultrawork/planner.md"

export const ULTRAWORK_DEFAULT_PROMPT = defaultPrompt
export const ULTRAWORK_GEMINI_PROMPT = geminiPrompt
export const ULTRAWORK_GPT_PROMPT = gptPrompt
export const ULTRAWORK_PLANNER_PROMPT = plannerPrompt
export const CODEX_ULTRAWORK_PROMPT = codexPrompt

export const ultraworkPromptVariants = {
  planner: {
    kind: "bundled",
    content: plannerPrompt,
    filePath: "packages/prompts-core/prompts/ultrawork/planner.md",
  },
  gpt: {
    kind: "bundled",
    content: gptPrompt,
    filePath: "packages/prompts-core/prompts/ultrawork/gpt.md",
  },
  gemini: {
    kind: "bundled",
    content: geminiPrompt,
    filePath: "packages/prompts-core/prompts/ultrawork/gemini.md",
  },
  default: {
    kind: "bundled",
    content: defaultPrompt,
    filePath: "packages/prompts-core/prompts/ultrawork/default.md",
  },
} satisfies VariantTable

export const codexUltraworkPromptVariants = {
  codex: {
    kind: "bundled",
    content: codexPrompt,
    filePath: "packages/prompts-core/prompts/ultrawork/codex.md",
  },
} satisfies VariantTable
