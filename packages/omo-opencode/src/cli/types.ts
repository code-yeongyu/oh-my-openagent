export type ClaudeSubscription = "no" | "yes" | "max20"
export type BooleanArg = "no" | "yes"
export type InstallPlatform = "opencode" | "codex" | "both"

export interface InstallArgs {
  tui: boolean
  platform?: InstallPlatform
  claude?: ClaudeSubscription
  openai?: BooleanArg
  gemini?: BooleanArg
  copilot?: BooleanArg
  opencodeZen?: BooleanArg
  zaiCodingPlan?: BooleanArg
  kimiForCoding?: BooleanArg
  opencodeGo?: BooleanArg
  bailianCodingPlan?: BooleanArg
  minimaxCnCodingPlan?: BooleanArg
  minimaxCodingPlan?: BooleanArg
  vercelAiGateway?: BooleanArg
  codexAutonomous?: boolean
  skipAuth?: boolean
}

export interface InstallConfig {
  platform: InstallPlatform
  hasOpenCode: boolean
  hasClaude: boolean
  isMax20: boolean
  hasOpenAI: boolean
  hasGemini: boolean
  hasCopilot: boolean
  hasCodex: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
  hasKimiForCoding: boolean
  hasOpencodeGo: boolean
  hasBailianCodingPlan: boolean
  hasMinimaxCnCodingPlan: boolean
  hasMinimaxCodingPlan: boolean
  hasVercelAiGateway: boolean
  codexAutonomous: boolean
}

export interface ConfigMergeResult {
  success: boolean
  configPath: string
  error?: string
}

export interface DetectedConfig {
  isInstalled: boolean
  installedVersion: string | null
  hasClaude: boolean
  isMax20: boolean
  hasOpenAI: boolean
  hasGemini: boolean
  hasCopilot: boolean
  hasCodex: boolean
  hasOpencodeZen: boolean
  hasZaiCodingPlan: boolean
  hasKimiForCoding: boolean
  hasOpencodeGo: boolean
  hasBailianCodingPlan: boolean
  hasMinimaxCnCodingPlan: boolean
  hasMinimaxCodingPlan: boolean
  hasVercelAiGateway: boolean
}
