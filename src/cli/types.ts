export type ClaudeSubscription = "no" | "yes" | "max20"
export type BooleanArg = "no" | "yes"
export type MiniMaxModelVariant = "standard" | "highspeed"

export interface InstallArgs {
  tui: boolean
  claude?: ClaudeSubscription
  openai?: BooleanArg
  gemini?: BooleanArg
  copilot?: BooleanArg
  opencodeZen?: BooleanArg
  zaiCodingPlan?: BooleanArg
  kimiForCoding?: BooleanArg
  minimaxCnCodingPlan?: BooleanArg
  minimaxCodingPlan?: BooleanArg
  minimaxModelVariant?: MiniMaxModelVariant
  opencodeGo?: BooleanArg
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
  hasMinimaxCnCodingPlan: boolean
  hasMinimaxCodingPlan: boolean
  minimaxModelVariant: MiniMaxModelVariant
  hasOpencodeGo: boolean
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
  hasMinimaxCnCodingPlan: boolean
  hasMinimaxCodingPlan: boolean
  minimaxModelVariant: MiniMaxModelVariant
  hasOpencodeGo: boolean
}
