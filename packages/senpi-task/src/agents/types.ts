import type { OmoConfigEnv } from "@oh-my-opencode/omo-config-core"

import type { AgentModelEntry } from "./agent-model-entry"

export type AgentToolRule = {
  readonly pattern: string
  readonly allow: boolean
}

export type AgentDefinition = {
  readonly name: string
  readonly description?: string
  readonly prompt?: string
  readonly mode?: string
  readonly model?: string
  readonly models?: readonly AgentModelEntry[]
  /** Ordered model-policy categories; the first that resolves supplies the model. Model only: the
   *  agent keeps its own prompt/tools; category prompt_append and tools are never applied. */
  readonly categories?: readonly string[]
  readonly variant?: string
  readonly reasoningEffort?: string
  readonly temperature?: number
  readonly tools?: readonly AgentToolRule[]
  readonly disable?: boolean
  readonly background?: boolean
  readonly executionMode?: string
  readonly allowedSubagents?: readonly string[]
  readonly disallowedTools?: readonly string[]
  readonly maxDepth?: number
  readonly maxTurns?: number
}

export type AgentDefinitionInput = AgentDefinition

export type AgentLoaderDiagnosticKind = "frontmatter" | "read" | "validation" | "config_parse"

export type AgentLoaderDiagnostic = {
  readonly kind: AgentLoaderDiagnosticKind
  readonly path: string
  readonly message: string
  readonly issuePaths?: readonly string[]
}

export type LoadAgentsOptions = {
  readonly env?: OmoConfigEnv
  readonly homeDir?: string
  readonly projectDir?: string
}

export type LoadAgentsResult = {
  readonly agents: Readonly<Record<string, AgentDefinition>>
  readonly diagnostics: readonly AgentLoaderDiagnostic[]
}
