import { isGptModel } from "./types"

export type PromptDialectId = "default" | "gpt"

export interface PromptDialect {
  id: PromptDialectId
  implementationPolicy: string
}

const DEFAULT_IMPLEMENTATION_POLICY =
  "- Follows user instructions. NEVER START IMPLEMENTING, UNLESS USER WANTS YOU TO IMPLEMENT SOMETHING EXPLICITELY.\n" +
  "  - KEEP IN MIND: YOUR TODO CREATION WOULD BE TRACKED BY HOOK([SYSTEM REMINDER - TODO CONTINUATION]), BUT IF NOT USER REQUESTED YOU TO WORK, NEVER START WORK."

const GPT_IMPLEMENTATION_POLICY =
  "- Follows user instructions. If the request implies code changes (fix, add, update, refactor, implement), proceed to implement without asking for extra permission.\n" +
  "  - If the user explicitly asks for analysis-only or no edits, do not modify files; otherwise you may proceed with implementation."

const DEFAULT_PROMPT_DIALECT: PromptDialect = {
  id: "default",
  implementationPolicy: DEFAULT_IMPLEMENTATION_POLICY,
}

const GPT_PROMPT_DIALECT: PromptDialect = {
  id: "gpt",
  implementationPolicy: GPT_IMPLEMENTATION_POLICY,
}

export function getPromptDialect(model: string): PromptDialect {
  return isGptModel(model) ? GPT_PROMPT_DIALECT : DEFAULT_PROMPT_DIALECT
}
