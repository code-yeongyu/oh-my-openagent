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

export type V2ToolDomain = {
  readonly transform: (callback: (editor: V2ToolEditor) => void) => Promise<V2Registration>
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

export type V2AgentDomain = {
  readonly list: () => Promise<V2Listed<V2AgentInfo>>
}

export type V2PluginContext = {
  readonly app: V2App
  readonly location: V2Location
  readonly options: Readonly<Record<string, unknown>>
  readonly tool: V2ToolDomain
  readonly model: V2ModelDomain
  readonly provider: V2ProviderDomain
  readonly agent: V2AgentDomain
}

export type V2PluginDefinition = {
  readonly id: string
  readonly setup: (context: V2PluginContext) => Promise<V2Cleanup>
}
