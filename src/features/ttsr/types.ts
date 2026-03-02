import type picomatch from "picomatch"

export type TtsrMatchSource = "text" | "thinking" | "tool"

export interface TtsrMatchContext {
  source: TtsrMatchSource
  toolName?: string
  filePaths?: string[]
  streamKey?: string
}

export interface TtsrScope {
  allowText: boolean
  allowThinking: boolean
  allowAnyTool: boolean
  toolScopes: Array<{ toolName: string; fileGlobs?: string[] }>
}

export interface TtsrEntry {
  rule: TtsrRule
  conditions: RegExp[]
  scope: TtsrScope
  globalPathGlobs?: ReturnType<typeof picomatch>
}

export interface TtsrSettings {
  enabled: boolean
  contextMode: "discard" | "keep"
  interruptMode: "always" | "prose-only" | "tool-only" | "never"
  repeatMode: "once" | "after-gap"
  repeatGap: number
  maxRetriesPerRule: number
}

export interface TtsrRule {
  name: string
  content: string
  path?: string
  condition: string[]
  scope: string[]
  globs?: string[]
}
