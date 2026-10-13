/**
 * Structural view of the OpenCode 2.x plugin context (`@opencode/plugin` `Plugin.Context`).
 *
 * The adapter types only the members it reads. `@opencode/plugin` is deliberately not a dependency:
 * it pulls its own `effect` peer, and `dependency-security.test.ts` pins the single locked
 * `effect` version that the OpenCode 1.x plugin package needs. The real 2.x binary is the drift
 * check (see the opencode-qa V2 scripts), not a compile-time import.
 */

export type V2Registration = {
  readonly dispose: () => Promise<void>
}

export type V2Cleanup = () => Promise<void> | void

export type V2LocationProject = {
  readonly id: string
  readonly directory: string
  readonly canonical: string
}

export type V2Location = {
  readonly directory: string
  readonly workspaceID?: string
  readonly project: V2LocationProject
}

export type V2App = {
  readonly name: string
  readonly version: string
  readonly channel: string
}

export type V2ToolContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }

export type V2ToolResult = {
  readonly output?: unknown
  readonly content?: string | ReadonlyArray<V2ToolContent>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type V2ToolExecuteContext = {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  readonly progress: (update: Readonly<Record<string, unknown>>) => Promise<void>
}

export type V2ToolInfo = {
  readonly name: string
  readonly description: string
  /** Standard Schema, Effect Schema or JSON Schema; zod v4 schemas are Standard Schema. */
  readonly input: unknown
  readonly execute: (input: any, context: V2ToolExecuteContext) => Promise<V2ToolResult>
  readonly options?: { readonly codemode?: boolean; readonly permission?: string; readonly namespace?: string }
}

export type V2ToolEditor = {
  readonly add: (tool: V2ToolInfo) => void
}

export type V2ToolContentPart = { type: string; text?: string; [key: string]: unknown }

export type V2ToolBeforeEvent = {
  tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  input: unknown
}

export type V2ToolAfterEvent = {
  readonly tool: string
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly input: unknown
  readonly status: "completed" | "error"
  /** Present when status is "completed"; the hook may rewrite it. */
  result?: { output?: unknown; content?: V2ToolContentPart[]; metadata?: Record<string, unknown> }
}

export type V2ToolDomain = {
  readonly transform: (callback: (editor: V2ToolEditor) => void) => Promise<V2Registration>
  readonly hook: {
    (name: "execute.before", callback: (event: V2ToolBeforeEvent) => Promise<void> | void): Promise<V2Registration>
    (name: "execute.after", callback: (event: V2ToolAfterEvent) => Promise<void> | void): Promise<V2Registration>
  }
}

export type V2Listed<T> = { readonly data: ReadonlyArray<T> }

export type V2ModelRef = { readonly providerID: string; readonly id: string; readonly variant?: string }

export type V2ModelInfo = {
  readonly id: string
  readonly modelID: string
  readonly providerID: string
  readonly name: string
  readonly status: "alpha" | "beta" | "deprecated" | "active"
  readonly enabled: boolean
  readonly capabilities: { readonly tools: boolean; readonly input: ReadonlyArray<string>; readonly output: ReadonlyArray<string> }
  readonly variants: ReadonlyArray<{ readonly id: string }>
  readonly limit: { readonly context: number; readonly input?: number; readonly output: number }
}

export type V2ProviderInfo = {
  readonly id: string
  readonly name: string
  readonly activation: "auto" | "enabled" | "disabled"
}

export type V2PermissionRule = {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

export type V2AgentInfo = {
  readonly id: string
  readonly name: string
  readonly model?: V2ModelRef
  readonly description?: string
  readonly mode: "subagent" | "primary" | "all"
  readonly hidden: boolean
  readonly color?: string
  readonly steps?: number
  readonly permissions: ReadonlyArray<V2PermissionRule>
}

export type V2ModelDomain = {
  readonly list: () => Promise<V2Listed<V2ModelInfo>>
  readonly default: () => Promise<{ readonly data: V2ModelInfo | null }>
}

export type V2ProviderDomain = {
  readonly list: () => Promise<V2Listed<V2ProviderInfo>>
}

/** A mutable 2.x agent as the agent transform hands it out. */
export type V2AgentRecord = {
  id: string
  name: string
  model?: V2ModelRef
  request: { settings: Record<string, unknown>; headers: Record<string, string>; body: Record<string, unknown> }
  system?: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  color?: string
  steps?: number
  permissions: V2PermissionRule[]
}

export type V2AgentEditor = {
  readonly list: () => V2AgentRecord[]
  readonly get: (id: string) => V2AgentRecord | undefined
  readonly default: (id: string | undefined) => void
  /** Creates the agent from 2.x defaults when the id is unknown. */
  readonly update: (id: string, update: (agent: V2AgentRecord) => void) => void
  readonly remove: (id: string) => void
}

export type V2AgentDomain = {
  readonly list: () => Promise<V2Listed<V2AgentInfo>>
  readonly transform: (callback: (editor: V2AgentEditor) => void) => Promise<V2Registration>
  readonly reload: () => Promise<void>
}

export type V2McpTimeout = { readonly startup?: number; readonly catalog?: number; readonly execution?: number }

export type V2McpServerConfig =
  | {
      readonly type: "local"
      readonly command: ReadonlyArray<string>
      readonly cwd?: string
      readonly environment?: Readonly<Record<string, string>>
      readonly disabled?: boolean
      readonly codemode?: boolean
      readonly timeout?: V2McpTimeout
    }
  | {
      readonly type: "remote"
      readonly url: string
      readonly headers?: Readonly<Record<string, string>>
      readonly oauth?: false | Readonly<Record<string, string | number>>
      readonly disabled?: boolean
      readonly codemode?: boolean
      readonly timeout?: V2McpTimeout
    }

export type V2McpEditor = {
  readonly list: () => ReadonlyArray<readonly [string, V2McpServerConfig]>
  readonly get: (name: string) => V2McpServerConfig | undefined
  readonly set: (name: string, config: V2McpServerConfig) => void
  readonly remove: (name: string) => void
}

export type V2McpDomain = {
  readonly transform: (callback: (editor: V2McpEditor) => void) => Promise<V2Registration>
  readonly reload: () => Promise<void>
}

export type V2PromptInput = {
  readonly sessionID: string
  readonly text: string
  readonly delivery?: "steer" | "queue" | null
  /** false enqueues the message without starting a turn. */
  readonly resume?: boolean | null
}

export type V2SyntheticInput = {
  readonly sessionID: string
  readonly text: string
  readonly description?: string | null
  readonly delivery?: "steer" | "queue" | null
  readonly resume?: boolean | null
}

export type V2TokenUsage = {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: { readonly read: number; readonly write: number }
}

export type V2SessionInfo = {
  readonly id: string
  readonly parentID?: string
  readonly projectID: string
  readonly agent?: string
  readonly model?: V2ModelRef
  readonly title?: string
  readonly cost: number
  readonly tokens: V2TokenUsage
  readonly time: { readonly created: number; readonly updated: number; readonly idle?: number }
  readonly location: { readonly directory: string }
}

export type V2StructuredError = { readonly type: string; readonly message: string; readonly status?: number }

export type V2ToolContentItem =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "file"; readonly uri: string; readonly mime: string; readonly name?: string }

export type V2ToolState =
  | { readonly status: "streaming"; readonly input: string }
  | { readonly status: "running"; readonly input: Readonly<Record<string, unknown>>; readonly metadata: Readonly<Record<string, unknown>> }
  | {
      readonly status: "completed"
      readonly input: Readonly<Record<string, unknown>>
      readonly content: ReadonlyArray<V2ToolContentItem>
      readonly metadata?: Readonly<Record<string, unknown>>
    }
  | {
      readonly status: "error"
      readonly input: Readonly<Record<string, unknown>>
      readonly error: V2StructuredError
      readonly content?: ReadonlyArray<V2ToolContentItem>
      readonly metadata?: Readonly<Record<string, unknown>>
    }

export type V2AssistantContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "reasoning"; readonly text: string; readonly time?: { readonly created: number; readonly completed?: number } }
  | {
      readonly type: "tool"
      readonly id: string
      readonly name: string
      readonly state: V2ToolState
      readonly time: { readonly created: number; readonly ran?: number; readonly completed?: number }
    }

type V2MessageBase = { readonly id: string; readonly time: { readonly created: number } }

/** The 2.x session message log entries the translator understands; others are ignored by type. */
export type V2SessionMessage =
  | (V2MessageBase & {
      readonly type: "user"
      readonly text: string
      readonly files?: ReadonlyArray<{ readonly uri: string; readonly name?: string }>
    })
  | (V2MessageBase & { readonly type: "synthetic" | "system"; readonly text: string })
  | (V2MessageBase & { readonly type: "skill"; readonly name: string; readonly text: string })
  | (V2MessageBase & { readonly type: "agent-switched"; readonly agent: string })
  | (V2MessageBase & { readonly type: "model-switched"; readonly model: V2ModelRef })
  | (V2MessageBase & {
      readonly type: "assistant"
      readonly agent: string
      readonly model: V2ModelRef
      readonly content: ReadonlyArray<V2AssistantContent>
      readonly finish?: string
      readonly cost?: number
      readonly tokens?: V2TokenUsage
      readonly error?: V2StructuredError
      readonly time: { readonly created: number; readonly streamed?: number; readonly completed?: number }
    })
  | (V2MessageBase & { readonly type: "compaction"; readonly status: "running" | "completed" | "failed"; readonly reason: "auto" | "manual"; readonly summary?: string })
  | (V2MessageBase & {
      readonly type: "idle"
      /** How the execution that just ended finished; absent on entries from hosts that do not record it. */
      readonly outcome?: "succeeded" | "failed" | "interrupted"
      readonly error?: V2StructuredError
    })
  | (V2MessageBase & { readonly type: "shell" | "location-switched" })

export type V2SessionDomain = {
  readonly get: (input: { readonly sessionID: string }) => Promise<V2SessionInfo>
  readonly create: (input: {
    readonly parentID?: string | null
    readonly title?: string | null
    readonly agent?: string | null
    readonly model?: V2ModelRef | null
    readonly location?: { readonly directory: string } | null
    readonly permissions?: ReadonlyArray<V2PermissionRule> | null
  }) => Promise<V2SessionInfo>
  readonly remove: (input: { readonly sessionID: string }) => Promise<void>
  readonly context: (input: { readonly sessionID: string }) => Promise<ReadonlyArray<V2SessionMessage>>
  readonly wait: (input: { readonly sessionID: string }) => Promise<void>
  readonly interrupt: (input: { readonly sessionID: string; readonly resume?: boolean }) => Promise<unknown>
  readonly compact: (input: { readonly sessionID: string }) => Promise<unknown>
  readonly prompt: (input: V2PromptInput) => Promise<unknown>
  readonly synthetic: (input: V2SyntheticInput) => Promise<unknown>
  readonly switchAgent: (input: { readonly sessionID: string; readonly agent: string }) => Promise<void>
  readonly switchModel: (input: { readonly sessionID: string; readonly model: V2ModelRef }) => Promise<void>
}

export type V2CommandInvocation = {
  readonly sessionID: string
  readonly prompt: { readonly text: string }
  readonly delivery: "steer" | "queue"
}

export type V2CommandDefinition = {
  readonly name: string
  readonly description?: string
  readonly execute: (invocation: V2CommandInvocation) => Promise<void>
}

export type V2CommandDomain = {
  readonly transform: (callback: (editor: { readonly add: (definition: V2CommandDefinition) => void }) => void) => Promise<V2Registration>
  readonly reload: () => Promise<void>
}

/** A host event: `data` is the event's schema fields, which for session events include `sessionID`. */
export type V2Event = { readonly type: string; readonly data?: unknown }

export type V2EventDomain = {
  readonly subscribe: (options?: { readonly signal?: AbortSignal }) => AsyncIterable<V2Event>
}

export type V2PluginContext = {
  readonly app: V2App
  readonly location: V2Location
  readonly options: Readonly<Record<string, unknown>>
  readonly tool: V2ToolDomain
  readonly model: V2ModelDomain
  readonly provider: V2ProviderDomain
  readonly agent: V2AgentDomain
  readonly mcp: V2McpDomain
  readonly command: V2CommandDomain
  readonly session: V2SessionDomain
  readonly event: V2EventDomain
}

export type V2PluginDefinition = {
  readonly id: string
  readonly setup: (context: V2PluginContext) => Promise<V2Cleanup>
}
