export interface LegacyContextFile {
  filename: string
  content: string
  source: "opencode-context" | "sisyphus-plan" | "hooks-config"
}

export interface NormalizedContext {
  topic: string
  content: string
  tags: string[]
  source: string
  normalizedAt: number
}
