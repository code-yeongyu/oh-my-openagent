export type ClaudeSubscription = "no" | "yes" | "max20"
export type BooleanArg = "no" | "yes"

export interface InstallArgs {
  tui: boolean
  claude?: ClaudeSubscription
  gemini?: BooleanArg
  copilot?: BooleanArg
  opencodeZen?: BooleanArg
  zaiCodingPlan?: BooleanArg
  skipAuth?: boolean
}

export interface InstallConfig {
  hasClaude: boolean
  isMax20: boolean
  hasGemini: boolean
  hasCopilot: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
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
  hasGemini: boolean
  hasCopilot: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
}
