export type ClaudeSubscription = "no" | "yes" | "max20"
export type BooleanArg = "no" | "yes"

export interface InstallArgs {
  tui: boolean
  claude?: ClaudeSubscription
  chatgpt?: BooleanArg
  gemini?: BooleanArg
  githubcopilot?: BooleanArg
  skipAuth?: boolean
  local?: boolean
}

export interface InstallConfig {
  hasClaude: boolean
  isMax20: boolean
  hasChatGPT: boolean
  hasGemini: boolean
  hasGitHubCopilot: boolean
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
  hasChatGPT: boolean
  hasGemini: boolean
  hasGitHubCopilot: boolean
}
