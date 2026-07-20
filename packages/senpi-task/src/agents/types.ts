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
  readonly models?: readonly string[]
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
  readonly homeDir?: string
  readonly projectDir?: string
}

export type LoadAgentsResult = {
  readonly agents: Readonly<Record<string, AgentDefinition>>
  readonly diagnostics: readonly AgentLoaderDiagnostic[]
}
