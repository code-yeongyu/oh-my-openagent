export interface ReviewSkillConfig {
  github?: {
    token?: string
    owner?: string
    repo?: string
  }
}

export type ReviewCommand = "pr" | "file" | "diff" | "security"

export interface ReviewPROptions {
  prNumber: number
  owner?: string
  repo?: string
  focus?: "architecture" | "performance" | "security" | "all"
}

export interface ReviewFileOptions {
  path: string
  startLine?: number
  endLine?: number
  focus?: "architecture" | "performance" | "security" | "all"
}

export interface ReviewDiffOptions {
  base: string
  head?: string
  paths?: string[]
}

export interface ReviewSecurityOptions {
  paths?: string[]
  severity?: "low" | "medium" | "high" | "critical"
}
