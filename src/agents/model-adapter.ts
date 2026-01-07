export type PromptDialectId = "default" | "gpt"

export interface PromptDialect {
  id: PromptDialectId
  implementationPolicy: string
  executionPolicy: string
}

export interface ModelCapabilities {
  supportsReasoningEffort: boolean
  supportsTextVerbosity: boolean
  supportsThinking: boolean
}

const DEFAULT_IMPLEMENTATION_POLICY =
  "- Follows user instructions. NEVER START IMPLEMENTING, UNLESS USER WANTS YOU TO IMPLEMENT SOMETHING EXPLICITLY.\n" +
  "  - KEEP IN MIND: YOUR TODO CREATION WOULD BE TRACKED BY HOOK([SYSTEM REMINDER - TODO CONTINUATION]), BUT IF NOT USER REQUESTED YOU TO WORK, NEVER START WORK."

const GPT_IMPLEMENTATION_POLICY =
  "- Follows user instructions. If the request implies code changes (fix, add, update, refactor, implement), proceed to implement without asking for extra permission.\n" +
  "  - If the user explicitly asks for analysis-only or no edits, do not modify files; otherwise you may proceed with implementation."

const GPT_EXECUTION_POLICY =
  "- When you need to change code, use tools. Do NOT output patches or diffs in chat.\n" +
  "  - Prefer tool calls over manual patch text."

export const DEFAULT_PROMPT_DIALECT: PromptDialect = {
  id: "default",
  implementationPolicy: DEFAULT_IMPLEMENTATION_POLICY,
  executionPolicy: "",
}

export const GPT_PROMPT_DIALECT: PromptDialect = {
  id: "gpt",
  implementationPolicy: GPT_IMPLEMENTATION_POLICY,
  executionPolicy: GPT_EXECUTION_POLICY,
}

const REASONING_MODELS = [/^gpt-5(\b|-)/, /^o1(\b|-)/, /^o3(\b|-)/]

function normalizeModelID(modelID: string): string {
  return modelID.replace(/\.(\d+)/g, "-$1")
}

function getBaseModelID(modelID: string): string {
  const lower = modelID.toLowerCase()
  const parts = lower.split("/")
  return normalizeModelID(parts[parts.length - 1] ?? lower)
}

function isOpenAIFamily(baseModelID: string): boolean {
  return (
    baseModelID.startsWith("gpt-") ||
    baseModelID.startsWith("codex-") ||
    baseModelID === "codex" ||
    /^o\d(\b|-)/.test(baseModelID)
  )
}

function isClaudeFamily(baseModelID: string): boolean {
  return baseModelID.includes("claude")
}

export interface ModelAdapter {
  id: string
  matches: (modelID: string) => boolean
  getPromptDialect: (modelID: string) => PromptDialect
  getModelCapabilities: (modelID: string) => ModelCapabilities
}

const openAIAdapter: ModelAdapter = {
  id: "openai-family",
  matches: (modelID) => isOpenAIFamily(getBaseModelID(modelID)),
  getPromptDialect: () => GPT_PROMPT_DIALECT,
  getModelCapabilities: (modelID) => {
    const base = getBaseModelID(modelID)
    const supportsReasoningEffort = REASONING_MODELS.some((pattern) => pattern.test(base))
    const supportsTextVerbosity = supportsReasoningEffort
    return { supportsReasoningEffort, supportsTextVerbosity, supportsThinking: false }
  },
}

const claudeAdapter: ModelAdapter = {
  id: "claude-family",
  matches: (modelID) => isClaudeFamily(getBaseModelID(modelID)),
  getPromptDialect: () => DEFAULT_PROMPT_DIALECT,
  getModelCapabilities: () => {
    return { supportsReasoningEffort: false, supportsTextVerbosity: false, supportsThinking: true }
  },
}

const defaultAdapter: ModelAdapter = {
  id: "default",
  matches: () => true,
  getPromptDialect: () => DEFAULT_PROMPT_DIALECT,
  getModelCapabilities: () => {
    return { supportsReasoningEffort: false, supportsTextVerbosity: false, supportsThinking: false }
  },
}

const MODEL_ADAPTERS: ModelAdapter[] = [openAIAdapter, claudeAdapter, defaultAdapter]

export function getModelAdapter(modelID: string): ModelAdapter {
  return MODEL_ADAPTERS.find((a) => a.matches(modelID)) ?? defaultAdapter
}

export function getPromptDialect(modelID: string): PromptDialect {
  return getModelAdapter(modelID).getPromptDialect(modelID)
}

export function getModelCapabilities(modelID: string): ModelCapabilities {
  return getModelAdapter(modelID).getModelCapabilities(modelID)
}

export function isGptModel(model: string): boolean {
  const base = getBaseModelID(model)
  return isOpenAIFamily(base)
}
