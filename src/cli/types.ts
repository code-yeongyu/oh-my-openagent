export type ClaudeSubscription = "no" | "yes" | "max20"
export type BooleanArg = "no" | "yes"

export type LocalProvider = "lmstudio" | "ollama" | "vllm"

export type LocalModelCapability = "multimodal" | "coding" | "general"

export type LocalModelTarget =
  | "explore"
  | "librarian"
  | "atlas"
  | "multimodal-looker"
  | "quick"
  | "unspecified-low"

export interface LocalModelConfig {
  id: string
  name: string
  contextLength?: number
  outputLength?: number
  capabilities: LocalModelCapability[]
  targets: LocalModelTarget[]
}

export interface LocalProviderModels {
  lmstudio: LocalModelConfig[]
  ollama: LocalModelConfig[]
  vllm: LocalModelConfig[]
}

export interface InstallArgs {
  tui: boolean
  claude?: ClaudeSubscription
  openai?: BooleanArg
  gemini?: BooleanArg
  copilot?: BooleanArg
  opencodeZen?: BooleanArg
  zaiCodingPlan?: BooleanArg
  kimiForCoding?: BooleanArg
  lmstudio?: string
  ollama?: string
  vllm?: string
  skipAuth?: boolean
}

export interface InstallConfig {
  hasClaude: boolean
  isMax20: boolean
  hasOpenAI: boolean
  hasGemini: boolean
  hasCopilot: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
  hasKimiForCoding: boolean
  hasLmstudio: boolean
  lmstudioUrl?: string
  hasOllama: boolean
  ollamaUrl?: string
  hasVllm: boolean
  vllmUrl?: string
  localProviderModels: LocalProviderModels
}

export interface ConfigMergeResult {
  success: boolean
  configPath: string
  error?: string
}

export interface DetectedConfig {
  isInstalled: boolean
  hasClaude: boolean
  isMax20: boolean
  hasOpenAI: boolean
  hasGemini: boolean
  hasCopilot: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
  hasKimiForCoding: boolean
  hasLmstudio?: boolean
  lmstudioUrl?: string
  hasOllama?: boolean
  ollamaUrl?: string
  hasVllm?: boolean
  vllmUrl?: string
}
